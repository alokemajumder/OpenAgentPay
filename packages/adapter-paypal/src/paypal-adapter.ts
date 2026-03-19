/**
 * @module paypal-adapter
 *
 * Server-side PayPal payment adapter for OpenAgentPay.
 *
 * The {@link PayPalAdapter} verifies PayPal order payments by calling
 * the PayPal REST API directly via `fetch`. No PayPal SDK dependency
 * is required.
 *
 * Agents include a PayPal Order ID in the `X-PAYPAL-ORDER` header.
 * The adapter verifies that the order is completed and the amount
 * matches the required pricing.
 *
 * @example
 * ```typescript
 * import { paypal } from '@openagentpay/adapter-paypal'
 *
 * const adapter = paypal({
 *   clientId: 'AaBb...',
 *   clientSecret: 'EeFf...',
 *   checkoutUrl: 'https://example.com/paypal/checkout',
 * })
 *
 * const paywall = createPaywall({
 *   adapters: [adapter],
 *   recipient: 'provider-id',
 * })
 * ```
 */

import type {
  PaymentAdapter,
  VerifyResult,
  PaymentProof,
  Pricing,
  PaymentMethod,
  AdapterConfig,
  IncomingRequest,
  AgentPaymentReceipt,
  PayPalPaymentMethod,
} from '@openagentpay/core'

import { FacilitatorUnavailableError } from '@openagentpay/core'

import type { PayPalAdapterConfig } from './types.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** HTTP header name for PayPal payment proofs. */
const PAYPAL_HEADER = 'x-paypal-order'

/** PayPal live API base URL. */
const PAYPAL_API_LIVE = 'https://api-m.paypal.com'

/** PayPal sandbox API base URL. */
const PAYPAL_API_SANDBOX = 'https://api-m.sandbox.paypal.com'

// ---------------------------------------------------------------------------
// Receipt ID Generation
// ---------------------------------------------------------------------------

/**
 * Generates a unique receipt ID with a timestamp prefix for sortability.
 * Uses a `pp_` prefix to distinguish PayPal receipts.
 */
function generateReceiptId(): string {
  const timestamp = Date.now().toString(36).padStart(10, '0')
  const chars = '0123456789abcdefghjkmnpqrstvwxyz'
  let random = ''
  for (let i = 0; i < 16; i++) {
    random += chars[Math.floor(Math.random() * chars.length)]
  }
  return `pp_${timestamp}${random}`
}

// ---------------------------------------------------------------------------
// PayPal API Response Shapes
// ---------------------------------------------------------------------------

/** Minimal shape of a PayPal Order from the API. */
interface PayPalOrder {
  id: string
  status: string
  purchase_units?: Array<{
    amount?: {
      currency_code?: string
      value?: string
    }
    payments?: {
      captures?: Array<{
        id: string
        status: string
        amount?: {
          currency_code?: string
          value?: string
        }
      }>
    }
  }>
  payer?: {
    email_address?: string
    payer_id?: string
  }
}

// ---------------------------------------------------------------------------
// PayPalAdapter
// ---------------------------------------------------------------------------

/**
 * Server-side payment adapter for PayPal payments.
 *
 * Implements the full {@link PaymentAdapter} interface for verifying
 * PayPal order payments.
 *
 * ## Detection
 *
 * Detects PayPal payments via the `X-PAYPAL-ORDER` HTTP header.
 * The header value should be a PayPal Order ID.
 *
 * ## Verification
 *
 * Calls the PayPal REST API to verify:
 * 1. The order exists and belongs to this application
 * 2. The order status is `COMPLETED`
 * 3. The captured amount matches or exceeds the required pricing
 *
 * ## Authentication
 *
 * Uses OAuth2 client credentials flow to obtain an access token
 * from PayPal before making API calls.
 *
 * @example
 * ```typescript
 * const adapter = new PayPalAdapter({
 *   clientId: 'AaBb...',
 *   clientSecret: 'EeFf...',
 *   checkoutUrl: 'https://example.com/paypal/checkout',
 *   sandbox: true,
 * })
 *
 * // Detection
 * adapter.detect(req) // true if X-PAYPAL-ORDER header is present
 *
 * // Verification
 * const result = await adapter.verify(req, { amount: '5.00', currency: 'USD' })
 * ```
 */
export class PayPalAdapter implements PaymentAdapter {
  /** Adapter type identifier. Always `"paypal"`. */
  readonly type = 'paypal' as const

  /** PayPal client ID. */
  private readonly clientId: string

  /** PayPal client secret. */
  private readonly clientSecret: string

  /** URL for PayPal Checkout credit purchases. */
  private readonly checkoutUrl?: string

  /** URL for PayPal billing agreement setup. */
  private readonly agreementUrl?: string

  /** PayPal API base URL (live or sandbox). */
  private readonly apiBase: string

  /** Cached OAuth2 access token. */
  private accessToken: string | null = null

  /** Token expiration timestamp (ms since epoch). */
  private tokenExpiresAt = 0

  /**
   * Creates a new PayPalAdapter.
   *
   * @param config - PayPal adapter configuration
   * @throws {Error} If required configuration is missing
   */
  constructor(config: PayPalAdapterConfig) {
    if (!config.clientId) {
      throw new Error('PayPalAdapter requires a clientId')
    }
    if (!config.clientSecret) {
      throw new Error('PayPalAdapter requires a clientSecret')
    }
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.checkoutUrl = config.checkoutUrl
    this.agreementUrl = config.agreementUrl
    this.apiBase = config.sandbox ? PAYPAL_API_SANDBOX : PAYPAL_API_LIVE
  }

  /**
   * Detects whether the incoming request carries a PayPal payment proof.
   *
   * Checks for the `X-PAYPAL-ORDER` header containing a PayPal Order ID.
   * PayPal Order IDs are alphanumeric strings (typically 17 characters).
   *
   * @param req - The incoming HTTP request
   * @returns `true` if the request contains a PayPal payment header
   */
  detect(req: IncomingRequest): boolean {
    const header = this.getHeader(req, PAYPAL_HEADER)
    if (typeof header !== 'string' || header.length === 0) return false
    // PayPal Order IDs are alphanumeric, typically 17+ chars
    return /^[A-Z0-9]{10,}$/i.test(header)
  }

  /**
   * Verifies a PayPal order payment by calling the PayPal REST API.
   *
   * Retrieves the order details and checks:
   * 1. Order status is `COMPLETED`
   * 2. The first purchase unit has a captured amount
   * 3. The captured amount matches or exceeds the required pricing
   * 4. The currency matches
   *
   * @param req - The incoming HTTP request with the `X-PAYPAL-ORDER` header
   * @param pricing - The pricing requirements for this endpoint
   * @returns Verification result with optional partial receipt
   */
  async verify(req: IncomingRequest, pricing: Pricing): Promise<VerifyResult> {
    const orderId = this.getHeader(req, PAYPAL_HEADER)
    if (!orderId) {
      return { valid: false, error: 'Missing X-PAYPAL-ORDER header' }
    }

    try {
      const order = await this.getOrder(orderId)

      if (order.status !== 'COMPLETED') {
        return {
          valid: false,
          error: `PayPal order status is '${order.status}', expected 'COMPLETED'`,
        }
      }

      // Extract the captured amount from the first purchase unit
      const purchaseUnit = order.purchase_units?.[0]
      const capture = purchaseUnit?.payments?.captures?.[0]

      if (!capture || capture.status !== 'COMPLETED') {
        return {
          valid: false,
          error: 'PayPal order has no completed capture',
        }
      }

      const capturedAmount = capture.amount?.value
      const capturedCurrency = capture.amount?.currency_code

      if (!capturedAmount || !capturedCurrency) {
        return {
          valid: false,
          error: 'PayPal capture is missing amount or currency',
        }
      }

      // Compare amounts as floats (PayPal uses decimal strings like "5.00")
      const required = parseFloat(pricing.amount)
      const actual = parseFloat(capturedAmount)

      if (isNaN(required) || isNaN(actual)) {
        return {
          valid: false,
          error: `Invalid amount format: required=${pricing.amount}, captured=${capturedAmount}`,
        }
      }

      if (actual < required - 0.001) {  // Small epsilon for float comparison
        return {
          valid: false,
          error: `Captured amount ${capturedAmount} ${capturedCurrency} is less than required ${pricing.amount} ${pricing.currency}`,
        }
      }

      // Currency check
      if (capturedCurrency.toUpperCase() !== pricing.currency.toUpperCase()) {
        return {
          valid: false,
          error: `Currency mismatch: capture is in ${capturedCurrency}, required ${pricing.currency}`,
        }
      }

      return {
        valid: true,
        receipt: this.buildReceipt(
          capturedAmount,
          capturedCurrency,
          capture.id,
          order.payer?.payer_id ?? order.payer?.email_address,
          req
        ),
      }
    } catch (err) {
      if (err instanceof FacilitatorUnavailableError) {
        throw err
      }
      const message = err instanceof Error ? err.message : 'Unknown error during PayPal verification'
      return { valid: false, error: message }
    }
  }

  /**
   * Generates the PayPal payment method descriptor for 402 responses.
   *
   * Returns a {@link PayPalPaymentMethod} that tells agents how to pay
   * via PayPal, including checkout and agreement URLs.
   *
   * @param _config - Adapter configuration (URLs come from constructor)
   * @returns A PayPalPaymentMethod for inclusion in the 402 response
   */
  describeMethod(_config: AdapterConfig): PaymentMethod {
    const method: PayPalPaymentMethod = {
      type: 'paypal',
    }
    if (this.checkoutUrl) method.checkout_url = this.checkoutUrl
    if (this.agreementUrl) method.agreement_url = this.agreementUrl
    if (this.clientId) method.client_id = this.clientId
    return method
  }

  /**
   * Checks whether this adapter handles the given payment method.
   *
   * @param method - The payment method to check
   * @returns `true` if the method type is `"paypal"`
   */
  supports(method: PaymentMethod): boolean {
    return method.type === 'paypal'
  }

  /**
   * Not applicable on the server side.
   *
   * PayPal payments are initiated by clients via PayPal Checkout.
   * Calling this method on the server adapter throws.
   *
   * @throws {Error} Always — server-side adapter cannot initiate payments
   */
  async pay(_method: PaymentMethod, _pricing: Pricing): Promise<PaymentProof> {
    throw new Error(
      'PayPalAdapter.pay() is not available on the server side. ' +
      'Use PayPal Checkout or the PayPal SDK to initiate payments.'
    )
  }

  // ---------------------------------------------------------------------------
  // Private: PayPal API Methods
  // ---------------------------------------------------------------------------

  /**
   * Retrieves a PayPal order by ID.
   *
   * @param orderId - The PayPal Order ID
   * @returns The order details
   * @throws {FacilitatorUnavailableError} On network or API errors
   */
  private async getOrder(orderId: string): Promise<PayPalOrder> {
    const token = await this.getAccessToken()

    let response: Response
    try {
      response = await fetch(`${this.apiBase}/v2/checkout/orders/${orderId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
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
        `PayPal API returned ${response.status}: ${body}`
      )
    }

    try {
      return await response.json() as PayPalOrder
    } catch {
      throw new FacilitatorUnavailableError('Invalid JSON response from PayPal API')
    }
  }

  /**
   * Obtains an OAuth2 access token from PayPal using client credentials.
   *
   * Caches the token and refreshes it when it expires (with a 60-second
   * buffer before actual expiry).
   *
   * @returns A valid access token
   * @throws {FacilitatorUnavailableError} On network or auth errors
   */
  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid (with 60s buffer)
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

    let data: { access_token: string; expires_in: number }
    try {
      data = await response.json() as { access_token: string; expires_in: number }
    } catch {
      throw new FacilitatorUnavailableError('Invalid JSON response from PayPal OAuth2 endpoint')
    }

    if (!data.access_token) {
      throw new FacilitatorUnavailableError(
        'PayPal OAuth2 response missing access_token'
      )
    }

    this.accessToken = data.access_token
    this.tokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000

    return this.accessToken
  }

  // ---------------------------------------------------------------------------
  // Private: Receipt Builder
  // ---------------------------------------------------------------------------

  /**
   * Builds a partial receipt from verified payment data.
   */
  private buildReceipt(
    amount: string,
    currency: string,
    captureId: string,
    payerIdentifier: string | undefined,
    req: IncomingRequest
  ): Partial<AgentPaymentReceipt> {
    const path = req.url ?? '/unknown'
    const method = req.method ?? 'GET'
    const now = new Date().toISOString()

    return {
      id: generateReceiptId(),
      version: '1.0',
      timestamp: now,
      payer: {
        type: 'agent',
        identifier: payerIdentifier ?? 'paypal-payer',
      },
      payee: {
        identifier: 'paypal-provider',
        endpoint: path,
      },
      request: {
        method,
        url: path,
      },
      payment: {
        amount,
        currency: currency.toUpperCase(),
        method: 'paypal',
        transaction_hash: captureId,
        status: 'settled',
      },
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Header Helper
  // ---------------------------------------------------------------------------

  /**
   * Extracts a header value from the request, handling case-insensitive
   * lookup and array-valued headers.
   */
  private getHeader(req: IncomingRequest, name: string): string | undefined {
    const headers = req.headers
    const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()]
    if (Array.isArray(value)) {
      return value[0]
    }
    return value ?? undefined
  }
}
