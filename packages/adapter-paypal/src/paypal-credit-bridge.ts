/**
 * @module paypal-credit-bridge
 *
 * Bridge between PayPal and the OpenAgentPay credit system.
 *
 * The {@link PayPalCreditBridge} creates PayPal orders for purchasing
 * credits, and provides a capture handler for fulfilling credit
 * purchases after the buyer approves the order.
 *
 * This enables agents to purchase credits via PayPal, which are then
 * spent per-call through the credits adapter.
 *
 * @example
 * ```typescript
 * import { PayPalCreditBridge } from '@openagentpay/adapter-paypal'
 * import { InMemoryCreditStore } from '@openagentpay/adapter-credits'
 *
 * const store = new InMemoryCreditStore()
 * const bridge = new PayPalCreditBridge({
 *   clientId: 'AaBb...',
 *   clientSecret: 'EeFf...',
 *   creditStore: store,
 *   returnUrl: 'https://example.com/paypal/return',
 *   cancelUrl: 'https://example.com/paypal/cancel',
 *   sandbox: true,
 * })
 *
 * // Create a PayPal order for $10 in credits
 * const { orderId, approvalUrl } = await bridge.createOrder({
 *   amount: '10.00',
 *   payerIdentifier: 'agent-1',
 * })
 *
 * // After buyer approves, capture the order
 * const result = await bridge.captureOrder(orderId)
 * // { accountId: 'agent-1', amount: '10.00' }
 * ```
 */

import { FacilitatorUnavailableError } from '@openagentpay/core'

import type { PayPalCreditBridgeConfig } from './types.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** PayPal live API base URL. */
const PAYPAL_API_LIVE = 'https://api-m.paypal.com'

/** PayPal sandbox API base URL. */
const PAYPAL_API_SANDBOX = 'https://api-m.sandbox.paypal.com'

// ---------------------------------------------------------------------------
// PayPal API Response Shapes
// ---------------------------------------------------------------------------

/** Minimal PayPal Create Order response. */
interface PayPalCreateOrderResponse {
  id: string
  status: string
  links?: Array<{
    href: string
    rel: string
    method: string
  }>
}

/** Minimal PayPal Capture Order response. */
interface PayPalCaptureOrderResponse {
  id: string
  status: string
  purchase_units?: Array<{
    reference_id?: string
    payments?: {
      captures?: Array<{
        id: string
        status: string
        amount?: {
          currency_code?: string
          value?: string
        }
        custom_id?: string
      }>
    }
  }>
}

// ---------------------------------------------------------------------------
// PayPalCreditBridge
// ---------------------------------------------------------------------------

/**
 * Bridge that connects PayPal to the OpenAgentPay credit system.
 *
 * Provides two main operations:
 *
 * 1. **Create Order** — creates a PayPal order for credit purchase and
 *    returns the approval URL where the buyer can authorize the payment.
 *
 * 2. **Capture Order** — captures the approved PayPal order and tops up
 *    (or creates) the agent's credit account.
 *
 * ## Flow
 *
 * 1. Server calls `createOrder()` and redirects agent to the approval URL
 * 2. Agent approves the payment on PayPal
 * 3. PayPal redirects agent back to `returnUrl`
 * 4. Server calls `captureOrder()` to finalize payment and credit the account
 *
 * ## Authentication
 *
 * Uses PayPal OAuth2 client credentials flow. Access tokens are cached
 * and refreshed automatically.
 *
 * @example
 * ```typescript
 * const bridge = new PayPalCreditBridge({
 *   clientId: 'AaBb...',
 *   clientSecret: 'EeFf...',
 *   creditStore: store,
 *   returnUrl: 'https://example.com/paypal/return',
 *   cancelUrl: 'https://example.com/paypal/cancel',
 *   sandbox: true,
 * })
 * ```
 */
export class PayPalCreditBridge {
  /** PayPal client ID. */
  private readonly clientId: string

  /** PayPal client secret. */
  private readonly clientSecret: string

  /** Credit store for depositing purchased credits. */
  private readonly creditStore: PayPalCreditBridgeConfig['creditStore']

  /** Return URL after buyer approval. */
  private readonly returnUrl: string

  /** Cancel URL if buyer cancels. */
  private readonly cancelUrl: string

  /** Currency code for credit purchases. */
  private readonly currency: string

  /** PayPal API base URL. */
  private readonly apiBase: string

  /** Cached OAuth2 access token. */
  private accessToken: string | null = null

  /** Token expiration timestamp (ms since epoch). */
  private tokenExpiresAt = 0

  /** In-memory mapping of orderId to payerIdentifier for capture fulfillment. */
  private readonly pendingOrders = new Map<string, string>()

  /**
   * Creates a new PayPalCreditBridge.
   *
   * @param config - Bridge configuration
   * @throws {Error} If required configuration is missing
   */
  constructor(config: PayPalCreditBridgeConfig) {
    if (!config.clientId) {
      throw new Error('PayPalCreditBridge requires a clientId')
    }
    if (!config.clientSecret) {
      throw new Error('PayPalCreditBridge requires a clientSecret')
    }
    if (!config.creditStore) {
      throw new Error('PayPalCreditBridge requires a creditStore')
    }
    if (!config.returnUrl) {
      throw new Error('PayPalCreditBridge requires a returnUrl')
    }
    if (!config.cancelUrl) {
      throw new Error('PayPalCreditBridge requires a cancelUrl')
    }

    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.creditStore = config.creditStore
    this.returnUrl = config.returnUrl
    this.cancelUrl = config.cancelUrl
    this.currency = config.currency ?? 'USD'
    this.apiBase = config.sandbox ? PAYPAL_API_SANDBOX : PAYPAL_API_LIVE
  }

  /**
   * Creates a PayPal order for purchasing credits.
   *
   * The order is created with `CAPTURE` intent and includes the payer
   * identifier in the `custom_id` field for later retrieval during
   * capture.
   *
   * @param options - Order creation options
   * @param options.amount - Amount as a decimal string (e.g. "10.00")
   * @param options.payerIdentifier - The agent/account identifier to credit
   * @returns The order ID and approval URL
   * @throws {FacilitatorUnavailableError} If the PayPal API is unreachable
   * @throws {Error} If the amount is invalid
   *
   * @example
   * ```typescript
   * const { orderId, approvalUrl } = await bridge.createOrder({
   *   amount: '25.00',
   *   payerIdentifier: 'agent-1',
   * })
   * // Redirect the agent to `approvalUrl` to approve the payment
   * ```
   */
  async createOrder(options: {
    amount: string
    payerIdentifier: string
  }): Promise<{ orderId: string; approvalUrl: string }> {
    const { amount, payerIdentifier } = options

    if (!amount || parseFloat(amount) <= 0) {
      throw new Error(`Invalid amount: ${amount}. Must be a positive decimal string.`)
    }

    if (!payerIdentifier) {
      throw new Error('payerIdentifier is required')
    }

    const token = await this.getAccessToken()

    const orderPayload = {
      intent: 'CAPTURE',
      purchase_units: [
        {
          amount: {
            currency_code: this.currency,
            value: amount,
          },
          description: `OpenAgentPay Credits - ${amount} ${this.currency}`,
          custom_id: payerIdentifier,
        },
      ],
      application_context: {
        return_url: this.returnUrl,
        cancel_url: this.cancelUrl,
        brand_name: 'OpenAgentPay',
        user_action: 'PAY_NOW',
      },
    }

    let response: Response
    try {
      response = await fetch(`${this.apiBase}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation',
        },
        body: JSON.stringify(orderPayload),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to reach PayPal API: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `PayPal Create Order failed (${response.status}): ${body}`
      )
    }

    const order = await response.json() as PayPalCreateOrderResponse

    // Find the approval link
    const approvalLink = order.links?.find(link => link.rel === 'approve')
    if (!approvalLink) {
      throw new FacilitatorUnavailableError(
        'PayPal order response missing approval link'
      )
    }

    // Store the mapping for capture fulfillment
    this.pendingOrders.set(order.id, payerIdentifier)

    return {
      orderId: order.id,
      approvalUrl: approvalLink.href,
    }
  }

  /**
   * Captures an approved PayPal order and credits the agent's account.
   *
   * After the buyer approves the order on PayPal, call this method to:
   * 1. Capture the payment via the PayPal API
   * 2. Extract the payer identifier from the `custom_id` field
   * 3. Create or top up the agent's credit account
   *
   * @param orderId - The PayPal Order ID to capture
   * @returns The credited account ID and amount
   * @throws {FacilitatorUnavailableError} If the PayPal API is unreachable
   * @throws {Error} If the capture fails or metadata is missing
   *
   * @example
   * ```typescript
   * // After buyer is redirected back to returnUrl:
   * const { accountId, amount } = await bridge.captureOrder(orderId)
   * console.log(`Credited ${amount} to ${accountId}`)
   * ```
   */
  async captureOrder(orderId: string): Promise<{ accountId: string; amount: string }> {
    if (!orderId) {
      throw new Error('orderId is required')
    }

    const token = await this.getAccessToken()

    let response: Response
    try {
      response = await fetch(`${this.apiBase}/v2/checkout/orders/${orderId}/capture`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation',
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to capture PayPal order: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `PayPal Capture Order failed (${response.status}): ${body}`
      )
    }

    const captured = await response.json() as PayPalCaptureOrderResponse

    if (captured.status !== 'COMPLETED') {
      throw new Error(
        `PayPal order capture status is '${captured.status}', expected 'COMPLETED'`
      )
    }

    // Extract amount and payer from the capture
    const capture = captured.purchase_units?.[0]?.payments?.captures?.[0]
    if (!capture || capture.status !== 'COMPLETED') {
      throw new Error('PayPal capture has no completed payment')
    }

    const capturedAmount = capture.amount?.value
    const currency = capture.amount?.currency_code

    if (!capturedAmount) {
      throw new Error('PayPal capture is missing amount')
    }

    // Get payer identifier from custom_id or pending orders map
    const payerIdentifier = capture.custom_id ?? this.pendingOrders.get(orderId)

    if (!payerIdentifier) {
      throw new Error(
        'Cannot determine payer identifier. Ensure createOrder was used ' +
        'to create this order, or custom_id is set on the purchase unit.'
      )
    }

    // Clean up pending orders
    this.pendingOrders.delete(orderId)

    // Credit the account
    const creditCurrency = (currency ?? this.currency).toUpperCase()

    try {
      const existingAccount = await this.creditStore.getAccount(payerIdentifier)
      if (existingAccount) {
        await this.creditStore.topUp(payerIdentifier, capturedAmount)
      } else {
        await this.creditStore.createAccount(payerIdentifier, capturedAmount, creditCurrency)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown credit store error'
      throw new FacilitatorUnavailableError(
        `Failed to credit account ${payerIdentifier}: ${message}`
      )
    }

    return {
      accountId: payerIdentifier,
      amount: capturedAmount,
    }
  }

  // ---------------------------------------------------------------------------
  // Private: OAuth2 Token Management
  // ---------------------------------------------------------------------------

  /**
   * Obtains an OAuth2 access token from PayPal using client credentials.
   *
   * Caches the token and refreshes it when it expires (with a 60-second buffer).
   *
   * @returns A valid access token
   * @throws {FacilitatorUnavailableError} On network or auth errors
   */
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.accessToken
    }

    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')

    let response: Response
    try {
      response = await fetch(`${this.apiBase}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to obtain PayPal access token: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `PayPal OAuth2 token request failed (${response.status}): ${body}`
      )
    }

    const data = await response.json() as { access_token: string; expires_in: number }

    if (!data.access_token) {
      throw new FacilitatorUnavailableError(
        'PayPal OAuth2 response missing access_token'
      )
    }

    this.accessToken = data.access_token
    this.tokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000

    return this.accessToken
  }
}
