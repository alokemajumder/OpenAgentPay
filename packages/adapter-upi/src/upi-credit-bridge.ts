/**
 * @module upi-credit-bridge
 *
 * Bridge between UPI payments and the OpenAgentPay credit system.
 *
 * The {@link UPICreditBridge} creates UPI payment links for purchasing
 * credits, and provides a callback handler for fulfilling credit
 * purchases after payment confirmation.
 *
 * This enables agents to purchase credits via UPI, which are then
 * spent per-call through the credits adapter.
 *
 * @example
 * ```typescript
 * import { UPICreditBridge } from '@openagentpay/adapter-upi'
 * import { InMemoryCreditStore } from '@openagentpay/adapter-credits'
 *
 * const store = new InMemoryCreditStore()
 * const bridge = new UPICreditBridge({
 *   gateway: 'razorpay',
 *   apiKey: 'rzp_live_...',
 *   apiSecret: 'secret_...',
 *   creditStore: store,
 *   callbackUrl: 'https://example.com/upi/callback',
 * })
 *
 * // Create a UPI payment link for Rs 500 in credits
 * const { paymentId, paymentUrl } = await bridge.createPaymentLink({
 *   amount: 50000,  // in paise
 *   payerIdentifier: 'agent-1',
 * })
 *
 * // Handle callback when payment completes
 * const result = await bridge.handlePaymentCallback(paymentId)
 * // { accountId: 'agent-1', amount: '500.00' }
 * ```
 */

import { FacilitatorUnavailableError } from '@openagentpay/core'

import type { UPICreditBridgeConfig } from './types.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Razorpay API base URL. */
const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1'

/** Cashfree production API base URL. */
const CASHFREE_API_LIVE = 'https://api.cashfree.com/pg'

/** Cashfree sandbox API base URL. */
const CASHFREE_API_SANDBOX = 'https://sandbox.cashfree.com/pg'

// ---------------------------------------------------------------------------
// Gateway Response Shapes
// ---------------------------------------------------------------------------

/** Razorpay payment link response. */
interface RazorpayPaymentLink {
  id: string
  short_url: string
  status: string
}

/** Razorpay payment status response. */
interface RazorpayPaymentStatus {
  id: string
  status: string
  amount: number
  currency: string
  notes?: Record<string, string>
}

/** Cashfree order response. */
interface CashfreeOrder {
  order_id: string
  payment_link?: string
  order_status: string
}

/** Cashfree payment response. */
interface CashfreePaymentStatus {
  cf_payment_id: string
  payment_status: string
  payment_amount: number
  payment_currency: string
}

// ---------------------------------------------------------------------------
// UPICreditBridge
// ---------------------------------------------------------------------------

/**
 * Bridge that connects UPI payments to the OpenAgentPay credit system.
 *
 * Provides two main operations:
 *
 * 1. **Create Payment Link** — generates a UPI payment link/QR code
 *    where agents can pay for credits.
 *
 * 2. **Handle Callback** — processes payment confirmations from the
 *    gateway and tops up (or creates) the agent's credit account.
 *
 * ## Amount Handling
 *
 * - Input amounts are in paise (1 INR = 100 paise)
 * - Credit amounts are stored as decimal strings (e.g. "500.00")
 * - The bridge converts between the two automatically
 *
 * ## Supported Gateways
 *
 * - **Razorpay** — creates payment links via the Razorpay API
 * - **Cashfree** — creates orders via the Cashfree API
 * - **Generic** — uses a configurable payment gateway API
 *
 * @example
 * ```typescript
 * const bridge = new UPICreditBridge({
 *   gateway: 'razorpay',
 *   apiKey: 'rzp_live_...',
 *   apiSecret: 'secret_...',
 *   creditStore: store,
 *   callbackUrl: 'https://example.com/upi/callback',
 *   currency: 'INR',
 * })
 * ```
 */
export class UPICreditBridge {
  /** Payment gateway provider. */
  private readonly gateway: 'razorpay' | 'cashfree' | 'generic'

  /** API key for the gateway. */
  private readonly apiKey: string

  /** API secret for the gateway. */
  private readonly apiSecret: string

  /** Credit store for depositing purchased credits. */
  private readonly creditStore: UPICreditBridgeConfig['creditStore']

  /** Callback URL for payment confirmations. */
  private readonly callbackUrl: string

  /** Currency code. */
  private readonly currency: string

  /** Whether to use sandbox. */
  private readonly sandbox: boolean

  /** In-memory mapping of paymentId to payerIdentifier. */
  private readonly pendingPayments = new Map<string, { payerIdentifier: string; amountPaise: number }>()

  /**
   * Creates a new UPICreditBridge.
   *
   * @param config - Bridge configuration
   * @throws {Error} If required configuration is missing
   */
  constructor(config: UPICreditBridgeConfig) {
    if (!config.apiKey) {
      throw new Error('UPICreditBridge requires an apiKey')
    }
    if (!config.apiSecret) {
      throw new Error('UPICreditBridge requires an apiSecret')
    }
    if (!config.creditStore) {
      throw new Error('UPICreditBridge requires a creditStore')
    }
    if (!config.callbackUrl) {
      throw new Error('UPICreditBridge requires a callbackUrl')
    }
    if (!config.gateway) {
      throw new Error('UPICreditBridge requires a gateway')
    }

    this.gateway = config.gateway
    this.apiKey = config.apiKey
    this.apiSecret = config.apiSecret
    this.creditStore = config.creditStore
    this.callbackUrl = config.callbackUrl
    this.currency = config.currency ?? 'INR'
    this.sandbox = config.sandbox ?? false
  }

  /**
   * Creates a UPI payment link for purchasing credits.
   *
   * Generates a payment link via the configured gateway. The agent
   * can use this link to pay via any UPI app.
   *
   * @param options - Payment link options
   * @param options.amount - Amount in paise (e.g. 50000 = Rs 500)
   * @param options.payerIdentifier - The agent/account identifier to credit
   * @param options.description - Optional description for the payment
   * @returns The payment ID and payment URL
   * @throws {FacilitatorUnavailableError} If the gateway API is unreachable
   * @throws {Error} If the amount is invalid
   *
   * @example
   * ```typescript
   * const { paymentId, paymentUrl } = await bridge.createPaymentLink({
   *   amount: 100000,  // Rs 1,000
   *   payerIdentifier: 'agent-1',
   *   description: 'API credits top-up',
   * })
   * ```
   */
  async createPaymentLink(options: {
    amount: number
    payerIdentifier: string
    description?: string
  }): Promise<{ paymentId: string; paymentUrl: string }> {
    const { amount, payerIdentifier, description } = options

    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error(
        `Invalid amount: ${amount}. Must be a positive integer in paise.`
      )
    }
    if (!payerIdentifier) {
      throw new Error('payerIdentifier is required')
    }

    const desc = description ?? `OpenAgentPay Credits - ${paiseToDecimal(amount)} ${this.currency}`

    let result: { paymentId: string; paymentUrl: string }

    switch (this.gateway) {
      case 'razorpay':
        result = await this.createRazorpayPaymentLink(amount, payerIdentifier, desc)
        break
      case 'cashfree':
        result = await this.createCashfreeOrder(amount, payerIdentifier, desc)
        break
      case 'generic':
        result = await this.createGenericPaymentLink(amount, payerIdentifier, desc)
        break
      default:
        throw new Error(`Unsupported gateway: ${this.gateway}`)
    }

    // Store the mapping for callback fulfillment
    this.pendingPayments.set(result.paymentId, { payerIdentifier, amountPaise: amount })

    return result
  }

  /**
   * Handles a payment callback and credits the agent's account.
   *
   * After the UPI payment is confirmed by the gateway, call this method to:
   * 1. Verify the payment status via the gateway API
   * 2. Extract the payer identifier from the stored mapping
   * 3. Create or top up the agent's credit account
   *
   * @param paymentId - The payment/order ID from the callback
   * @returns The credited account ID and amount
   * @throws {FacilitatorUnavailableError} If the gateway API is unreachable
   * @throws {Error} If the payment is not found or not completed
   *
   * @example
   * ```typescript
   * // In your callback handler:
   * app.post('/upi/callback', async (req, res) => {
   *   const { accountId, amount } = await bridge.handlePaymentCallback(
   *     req.body.payment_id
   *   )
   *   console.log(`Credited ${amount} to ${accountId}`)
   *   res.status(200).send('ok')
   * })
   * ```
   */
  async handlePaymentCallback(paymentId: string): Promise<{ accountId: string; amount: string }> {
    if (!paymentId) {
      throw new Error('paymentId is required')
    }

    const pending = this.pendingPayments.get(paymentId)
    if (!pending) {
      throw new Error(
        `Unknown payment ID: ${paymentId}. Ensure createPaymentLink was used.`
      )
    }

    // Verify the payment status with the gateway
    const isComplete = await this.verifyPaymentComplete(paymentId)
    if (!isComplete) {
      throw new Error(`Payment ${paymentId} is not yet completed`)
    }

    const { payerIdentifier, amountPaise } = pending
    const decimalAmount = paiseToDecimal(amountPaise)

    // Clean up pending payment
    this.pendingPayments.delete(paymentId)

    // Credit the account
    try {
      const existingAccount = await this.creditStore.getAccount(payerIdentifier)
      if (existingAccount) {
        await this.creditStore.topUp(payerIdentifier, decimalAmount)
      } else {
        await this.creditStore.createAccount(payerIdentifier, decimalAmount, this.currency.toUpperCase())
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown credit store error'
      throw new FacilitatorUnavailableError(
        `Failed to credit account ${payerIdentifier}: ${message}`
      )
    }

    return {
      accountId: payerIdentifier,
      amount: decimalAmount,
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Razorpay Implementation
  // ---------------------------------------------------------------------------

  private getBasicAuth(): string {
    return Buffer.from(`${this.apiKey}:${this.apiSecret}`).toString('base64')
  }

  private async createRazorpayPaymentLink(
    amount: number,
    payerIdentifier: string,
    description: string
  ): Promise<{ paymentId: string; paymentUrl: string }> {
    const payload = {
      amount,
      currency: this.currency,
      description,
      callback_url: this.callbackUrl,
      callback_method: 'get',
      upi_link: true,
      notes: {
        payer_identifier: payerIdentifier,
      },
    }

    let response: Response
    try {
      response = await fetch(`${RAZORPAY_API_BASE}/payment_links`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${this.getBasicAuth()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to reach Razorpay API: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Razorpay create payment link failed (${response.status}): ${body}`
      )
    }

    const link = await response.json() as RazorpayPaymentLink

    return {
      paymentId: link.id,
      paymentUrl: link.short_url,
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Cashfree Implementation
  // ---------------------------------------------------------------------------

  private getCashfreeBase(): string {
    return this.sandbox ? CASHFREE_API_SANDBOX : CASHFREE_API_LIVE
  }

  private getCashfreeHeaders(): Record<string, string> {
    return {
      'x-client-id': this.apiKey,
      'x-client-secret': this.apiSecret,
      'x-api-version': '2023-08-01',
      'Content-Type': 'application/json',
    }
  }

  private async createCashfreeOrder(
    amount: number,
    payerIdentifier: string,
    description: string
  ): Promise<{ paymentId: string; paymentUrl: string }> {
    const base = this.getCashfreeBase()
    const orderId = `oap_${Date.now()}_${payerIdentifier.slice(0, 8)}`

    const orderPayload = {
      order_id: orderId,
      order_amount: amount / 100,  // Cashfree uses INR, not paise
      order_currency: this.currency,
      order_note: description,
      customer_details: {
        customer_id: payerIdentifier,
        customer_name: payerIdentifier,
      },
      order_meta: {
        return_url: this.callbackUrl,
        payment_methods: 'upi',
      },
    }

    let response: Response
    try {
      response = await fetch(`${base}/orders`, {
        method: 'POST',
        headers: this.getCashfreeHeaders(),
        body: JSON.stringify(orderPayload),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to reach Cashfree API: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Cashfree create order failed (${response.status}): ${body}`
      )
    }

    const order = await response.json() as CashfreeOrder

    return {
      paymentId: order.order_id,
      paymentUrl: order.payment_link ?? '',
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Generic Gateway Implementation
  // ---------------------------------------------------------------------------

  private async createGenericPaymentLink(
    amount: number,
    payerIdentifier: string,
    description: string
  ): Promise<{ paymentId: string; paymentUrl: string }> {
    const payload = {
      amount,
      currency: this.currency,
      description,
      payer_identifier: payerIdentifier,
      callback_url: this.callbackUrl,
      payment_method: 'upi',
    }

    let response: Response
    try {
      response = await fetch('https://api.payment-gateway.com/v1/payment-links', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to create payment link: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Generic gateway payment link creation failed (${response.status}): ${body}`
      )
    }

    const result = await response.json() as { id: string; url: string }
    return { paymentId: result.id, paymentUrl: result.url }
  }

  // ---------------------------------------------------------------------------
  // Private: Payment Verification
  // ---------------------------------------------------------------------------

  /**
   * Verifies that a payment has been completed by checking the gateway.
   *
   * @param paymentId - The payment/order ID to check
   * @returns true if the payment is complete
   */
  private async verifyPaymentComplete(paymentId: string): Promise<boolean> {
    switch (this.gateway) {
      case 'razorpay':
        return this.verifyRazorpayPayment(paymentId)
      case 'cashfree':
        return this.verifyCashfreePayment(paymentId)
      case 'generic':
        return this.verifyGenericPayment(paymentId)
      default:
        return false
    }
  }

  private async verifyRazorpayPayment(paymentLinkId: string): Promise<boolean> {
    let response: Response
    try {
      response = await fetch(`${RAZORPAY_API_BASE}/payment_links/${paymentLinkId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${this.getBasicAuth()}`,
          'Content-Type': 'application/json',
        },
      })
    } catch {
      return false
    }

    if (!response.ok) return false

    const link = await response.json() as RazorpayPaymentLink
    return link.status === 'paid'
  }

  private async verifyCashfreePayment(orderId: string): Promise<boolean> {
    const base = this.getCashfreeBase()

    let response: Response
    try {
      response = await fetch(`${base}/orders/${orderId}/payments`, {
        method: 'GET',
        headers: this.getCashfreeHeaders(),
      })
    } catch {
      return false
    }

    if (!response.ok) return false

    const payments = await response.json() as CashfreePaymentStatus[]
    return payments.some(p => p.payment_status === 'SUCCESS')
  }

  private async verifyGenericPayment(paymentId: string): Promise<boolean> {
    let response: Response
    try {
      response = await fetch(`https://api.payment-gateway.com/v1/payments/${paymentId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      })
    } catch {
      return false
    }

    if (!response.ok) return false

    const payment = await response.json() as { status: string }
    return payment.status === 'success' || payment.status === 'completed'
  }
}

// ---------------------------------------------------------------------------
// Amount Conversion Helper
// ---------------------------------------------------------------------------

/**
 * Converts an integer paise amount to a decimal string in INR.
 *
 * @param paise - Integer amount in paise
 * @returns Decimal string (e.g. "500.00")
 */
function paiseToDecimal(paise: number): string {
  const rupees = Math.floor(paise / 100)
  const remainder = paise % 100
  return `${rupees}.${remainder.toString().padStart(2, '0')}`
}
