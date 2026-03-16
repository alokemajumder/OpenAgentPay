/**
 * @module upi-adapter
 *
 * Server-side UPI payment adapter for OpenAgentPay.
 *
 * The {@link UPIAdapter} verifies UPI transaction payments by calling
 * the configured payment gateway's REST API directly via `fetch`.
 * Supports Razorpay, Cashfree, and generic gateway implementations.
 *
 * Agents include a UPI transaction reference in the `X-UPI-REFERENCE`
 * header. The adapter verifies that the transaction succeeded and the
 * amount matches the required pricing.
 *
 * @example
 * ```typescript
 * import { upi } from '@openagentpay/adapter-upi'
 *
 * const adapter = upi({
 *   gateway: 'razorpay',
 *   apiKey: 'rzp_live_...',
 *   apiSecret: 'secret_...',
 *   checkoutUrl: 'https://example.com/upi/checkout',
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
  UPIPaymentMethod,
} from '@openagentpay/core'

import { FacilitatorUnavailableError } from '@openagentpay/core'

import type { UPIAdapterConfig } from './types.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** HTTP header name for UPI payment proofs. */
const UPI_HEADER = 'x-upi-reference'

/** Razorpay API base URL. */
const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1'

/** Cashfree production API base URL. */
const CASHFREE_API_LIVE = 'https://api.cashfree.com/pg'

/** Cashfree sandbox API base URL. */
const CASHFREE_API_SANDBOX = 'https://sandbox.cashfree.com/pg'

// ---------------------------------------------------------------------------
// Receipt ID Generation
// ---------------------------------------------------------------------------

/**
 * Generates a unique receipt ID with a timestamp prefix for sortability.
 * Uses a `upi_` prefix to distinguish UPI receipts.
 */
function generateReceiptId(): string {
  const timestamp = Date.now().toString(36).padStart(10, '0')
  const chars = '0123456789abcdefghjkmnpqrstvwxyz'
  let random = ''
  for (let i = 0; i < 16; i++) {
    random += chars[Math.floor(Math.random() * chars.length)]
  }
  return `upi_${timestamp}${random}`
}

// ---------------------------------------------------------------------------
// Gateway Response Shapes
// ---------------------------------------------------------------------------

/** Razorpay payment response shape. */
interface RazorpayPayment {
  id: string
  status: string
  amount: number        // in paise
  currency: string
  method?: string
  vpa?: string
  email?: string
  contact?: string
}

/** Cashfree payment response shape. */
interface CashfreePayment {
  cf_payment_id: string
  payment_status: string
  payment_amount: number  // in INR (decimal)
  payment_currency: string
  payment_method?: {
    upi?: {
      upi_id?: string
    }
  }
}

/** Generic gateway payment response shape. */
interface GenericPayment {
  id: string
  status: string
  amount: number
  currency: string
  payer_vpa?: string
}

// ---------------------------------------------------------------------------
// UPIAdapter
// ---------------------------------------------------------------------------

/**
 * Server-side payment adapter for UPI payments.
 *
 * Implements the full {@link PaymentAdapter} interface for verifying
 * UPI transaction payments via payment gateway APIs.
 *
 * ## Detection
 *
 * Detects UPI payments via the `X-UPI-REFERENCE` HTTP header. The header
 * value should be a payment/transaction ID from the payment gateway.
 *
 * ## Verification
 *
 * Calls the configured payment gateway API to verify:
 * 1. The transaction exists
 * 2. The payment status is successful
 * 3. The amount matches or exceeds the required pricing
 *
 * ## Supported Gateways
 *
 * - **Razorpay** — uses Basic Auth with `apiKey:apiSecret`
 * - **Cashfree** — uses `x-api-version` and `x-client-id`/`x-client-secret` headers
 * - **Generic** — uses Bearer token auth with a configurable endpoint
 *
 * ## Amount Handling
 *
 * UPI amounts are in paise (1 INR = 100 paise) for Razorpay, and in
 * decimal INR for Cashfree. The adapter normalizes between formats.
 *
 * @example
 * ```typescript
 * const adapter = new UPIAdapter({
 *   gateway: 'razorpay',
 *   apiKey: 'rzp_live_...',
 *   apiSecret: 'secret_...',
 *   checkoutUrl: 'https://example.com/upi/checkout',
 *   mandateUrl: 'https://example.com/upi/mandate',
 * })
 *
 * adapter.detect(req) // true if X-UPI-REFERENCE header is present
 * const result = await adapter.verify(req, { amount: '100.00', currency: 'INR' })
 * ```
 */
export class UPIAdapter implements PaymentAdapter {
  /** Adapter type identifier. Always `"upi"`. */
  readonly type = 'upi' as const

  /** Payment gateway provider. */
  private readonly gateway: 'razorpay' | 'cashfree' | 'generic'

  /** API key for the gateway. */
  private readonly apiKey: string

  /** API secret for the gateway. */
  private readonly apiSecret: string

  /** URL for UPI credit purchases. */
  private readonly checkoutUrl?: string

  /** URL for UPI mandate setup. */
  private readonly mandateUrl?: string

  /** Whether to use sandbox environment. */
  private readonly sandbox: boolean

  /**
   * Creates a new UPIAdapter.
   *
   * @param config - UPI adapter configuration
   * @throws {Error} If required configuration is missing
   */
  constructor(config: UPIAdapterConfig) {
    if (!config.apiKey) {
      throw new Error('UPIAdapter requires an apiKey')
    }
    if (!config.apiSecret) {
      throw new Error('UPIAdapter requires an apiSecret')
    }
    if (!config.gateway) {
      throw new Error('UPIAdapter requires a gateway')
    }
    this.gateway = config.gateway
    this.apiKey = config.apiKey
    this.apiSecret = config.apiSecret
    this.checkoutUrl = config.checkoutUrl
    this.mandateUrl = config.mandateUrl
    this.sandbox = config.sandbox ?? false
  }

  /**
   * Detects whether the incoming request carries a UPI payment proof.
   *
   * Checks for the `X-UPI-REFERENCE` header containing a transaction
   * reference ID. The reference must be a non-empty alphanumeric string.
   *
   * @param req - The incoming HTTP request
   * @returns `true` if the request contains a UPI payment header
   */
  detect(req: IncomingRequest): boolean {
    const header = this.getHeader(req, UPI_HEADER)
    if (typeof header !== 'string' || header.length === 0) return false
    // UPI reference IDs are typically alphanumeric with underscores
    return /^[A-Za-z0-9_-]{4,}$/.test(header)
  }

  /**
   * Verifies a UPI payment by calling the payment gateway API.
   *
   * Dispatches to the appropriate gateway-specific verification method
   * based on the configured gateway.
   *
   * @param req - The incoming HTTP request with the `X-UPI-REFERENCE` header
   * @param pricing - The pricing requirements for this endpoint
   * @returns Verification result with optional partial receipt
   */
  async verify(req: IncomingRequest, pricing: Pricing): Promise<VerifyResult> {
    const reference = this.getHeader(req, UPI_HEADER)
    if (!reference) {
      return { valid: false, error: 'Missing X-UPI-REFERENCE header' }
    }

    try {
      switch (this.gateway) {
        case 'razorpay':
          return await this.verifyRazorpay(reference, pricing, req)
        case 'cashfree':
          return await this.verifyCashfree(reference, pricing, req)
        case 'generic':
          return await this.verifyGeneric(reference, pricing, req)
        default:
          return { valid: false, error: `Unsupported gateway: ${this.gateway}` }
      }
    } catch (err) {
      if (err instanceof FacilitatorUnavailableError) {
        throw err
      }
      const message = err instanceof Error ? err.message : 'Unknown error during UPI verification'
      return { valid: false, error: message }
    }
  }

  /**
   * Generates the UPI payment method descriptor for 402 responses.
   *
   * Returns a {@link UPIPaymentMethod} that tells agents how to pay
   * via UPI, including checkout and mandate URLs.
   *
   * @param _config - Adapter configuration (URLs come from constructor)
   * @returns A UPIPaymentMethod for inclusion in the 402 response
   */
  describeMethod(_config: AdapterConfig): PaymentMethod {
    const method: UPIPaymentMethod = {
      type: 'upi',
    }
    if (this.checkoutUrl) method.checkout_url = this.checkoutUrl
    if (this.mandateUrl) method.mandate_url = this.mandateUrl
    method.gateway = this.gateway
    return method
  }

  /**
   * Checks whether this adapter handles the given payment method.
   *
   * @param method - The payment method to check
   * @returns `true` if the method type is `"upi"`
   */
  supports(method: PaymentMethod): boolean {
    return method.type === 'upi'
  }

  /**
   * Not applicable on the server side.
   *
   * UPI payments are initiated by clients via UPI apps or mandate debits.
   * Calling this method on the server adapter throws.
   *
   * @throws {Error} Always — server-side adapter cannot initiate payments
   */
  async pay(_method: PaymentMethod, _pricing: Pricing): Promise<PaymentProof> {
    throw new Error(
      'UPIAdapter.pay() is not available on the server side. ' +
      'Use a UPI payment link or mandate debit to initiate payments.'
    )
  }

  // ---------------------------------------------------------------------------
  // Private: Razorpay Verification
  // ---------------------------------------------------------------------------

  /**
   * Verifies a payment via the Razorpay API.
   *
   * Razorpay uses Basic Auth and amounts are in paise (1 INR = 100 paise).
   *
   * @param paymentId - Razorpay payment ID (e.g. pay_...)
   * @param pricing - Required pricing
   * @param req - Original request for receipt generation
   * @returns Verification result
   */
  private async verifyRazorpay(
    paymentId: string,
    pricing: Pricing,
    req: IncomingRequest
  ): Promise<VerifyResult> {
    const credentials = Buffer.from(`${this.apiKey}:${this.apiSecret}`).toString('base64')

    let response: Response
    try {
      response = await fetch(`${RAZORPAY_API_BASE}/payments/${paymentId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/json',
        },
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
        `Razorpay API returned ${response.status}: ${body}`
      )
    }

    const payment = await response.json() as RazorpayPayment

    if (payment.status !== 'captured') {
      return {
        valid: false,
        error: `Razorpay payment status is '${payment.status}', expected 'captured'`,
      }
    }

    // Razorpay amounts are in paise; pricing amounts are decimal strings in INR
    const requiredPaise = decimalToPaise(pricing.amount)

    if (payment.amount < requiredPaise) {
      return {
        valid: false,
        error: `Payment amount ${payment.amount} paise is less than required ${requiredPaise} paise`,
      }
    }

    if (payment.currency.toUpperCase() !== pricing.currency.toUpperCase()) {
      return {
        valid: false,
        error: `Currency mismatch: payment is in ${payment.currency}, required ${pricing.currency}`,
      }
    }

    return {
      valid: true,
      receipt: this.buildReceipt(
        paiseToDecimal(payment.amount),
        payment.currency,
        paymentId,
        payment.vpa ?? payment.contact,
        req
      ),
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Cashfree Verification
  // ---------------------------------------------------------------------------

  /**
   * Verifies a payment via the Cashfree API.
   *
   * Cashfree uses API key/secret headers and amounts are in decimal INR.
   *
   * @param paymentId - Cashfree payment ID
   * @param pricing - Required pricing
   * @param req - Original request for receipt generation
   * @returns Verification result
   */
  private async verifyCashfree(
    paymentId: string,
    pricing: Pricing,
    req: IncomingRequest
  ): Promise<VerifyResult> {
    const apiBase = this.sandbox ? CASHFREE_API_SANDBOX : CASHFREE_API_LIVE

    let response: Response
    try {
      response = await fetch(`${apiBase}/orders/${paymentId}/payments`, {
        method: 'GET',
        headers: {
          'x-client-id': this.apiKey,
          'x-client-secret': this.apiSecret,
          'x-api-version': '2023-08-01',
          'Content-Type': 'application/json',
        },
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
        `Cashfree API returned ${response.status}: ${body}`
      )
    }

    const payments = await response.json() as CashfreePayment[]

    // Find a successful payment
    const successfulPayment = payments.find(p => p.payment_status === 'SUCCESS')

    if (!successfulPayment) {
      return {
        valid: false,
        error: 'No successful payment found for this Cashfree order',
      }
    }

    // Cashfree amounts are in decimal INR
    const required = parseFloat(pricing.amount)
    const actual = successfulPayment.payment_amount

    if (isNaN(required) || actual < required - 0.01) {
      return {
        valid: false,
        error: `Payment amount ${actual} is less than required ${pricing.amount}`,
      }
    }

    const currency = successfulPayment.payment_currency
    if (currency.toUpperCase() !== pricing.currency.toUpperCase()) {
      return {
        valid: false,
        error: `Currency mismatch: payment is in ${currency}, required ${pricing.currency}`,
      }
    }

    return {
      valid: true,
      receipt: this.buildReceipt(
        actual.toFixed(2),
        currency,
        successfulPayment.cf_payment_id.toString(),
        successfulPayment.payment_method?.upi?.upi_id,
        req
      ),
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Generic Gateway Verification
  // ---------------------------------------------------------------------------

  /**
   * Verifies a payment via a generic gateway API.
   *
   * Uses Bearer token auth and expects a standard payment status response.
   *
   * @param transactionId - Transaction reference ID
   * @param pricing - Required pricing
   * @param req - Original request for receipt generation
   * @returns Verification result
   */
  private async verifyGeneric(
    transactionId: string,
    pricing: Pricing,
    req: IncomingRequest
  ): Promise<VerifyResult> {
    let response: Response
    try {
      response = await fetch(
        `https://api.payment-gateway.com/v1/transactions/${transactionId}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to reach payment gateway API: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Payment gateway API returned ${response.status}: ${body}`
      )
    }

    const payment = await response.json() as GenericPayment

    if (payment.status !== 'success' && payment.status !== 'completed') {
      return {
        valid: false,
        error: `Transaction status is '${payment.status}', expected 'success' or 'completed'`,
      }
    }

    // Generic gateway: amount in paise
    const requiredPaise = decimalToPaise(pricing.amount)

    if (payment.amount < requiredPaise) {
      return {
        valid: false,
        error: `Transaction amount ${payment.amount} paise is less than required ${requiredPaise} paise`,
      }
    }

    if (payment.currency.toUpperCase() !== pricing.currency.toUpperCase()) {
      return {
        valid: false,
        error: `Currency mismatch: transaction is in ${payment.currency}, required ${pricing.currency}`,
      }
    }

    return {
      valid: true,
      receipt: this.buildReceipt(
        paiseToDecimal(payment.amount),
        payment.currency,
        transactionId,
        payment.payer_vpa,
        req
      ),
    }
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
    transactionRef: string,
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
        identifier: payerIdentifier ?? 'upi-payer',
      },
      payee: {
        identifier: 'upi-provider',
        endpoint: path,
      },
      request: {
        method,
        url: path,
      },
      payment: {
        amount,
        currency: currency.toUpperCase(),
        method: 'upi',
        transaction_hash: transactionRef,
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

// ---------------------------------------------------------------------------
// Amount Conversion Helpers
// ---------------------------------------------------------------------------

/**
 * Converts a decimal string in INR (e.g. "100.50") to paise (e.g. 10050).
 *
 * @param amount - Decimal string amount in INR
 * @returns Integer amount in paise
 */
function decimalToPaise(amount: string): number {
  const parts = amount.split('.')
  const rupees = parseInt(parts[0] ?? '0', 10)
  const paiseStr = (parts[1] ?? '00').padEnd(2, '0').slice(0, 2)
  const paise = parseInt(paiseStr, 10)
  return rupees * 100 + paise
}

/**
 * Converts an integer paise amount to a decimal string in INR.
 *
 * @param paise - Integer amount in paise
 * @returns Decimal string (e.g. "100.50")
 */
function paiseToDecimal(paise: number): string {
  const rupees = Math.floor(paise / 100)
  const remainder = paise % 100
  return `${rupees}.${remainder.toString().padStart(2, '0')}`
}
