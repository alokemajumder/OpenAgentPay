/**
 * @module stripe-adapter
 *
 * Server-side Stripe payment adapter for OpenAgentPay.
 *
 * The {@link StripeAdapter} verifies Stripe PaymentIntent payments by
 * calling the Stripe REST API directly via `fetch`. No Stripe SDK
 * dependency is required.
 *
 * Agents include a Stripe PaymentIntent ID or Checkout Session ID in
 * the `X-STRIPE-SESSION` header. The adapter verifies that the payment
 * succeeded and the amount matches the required pricing.
 *
 * @example
 * ```typescript
 * import { stripe } from '@openagentpay/adapter-stripe'
 *
 * const adapter = stripe({
 *   secretKey: 'sk_live_...',
 *   checkoutUrl: 'https://example.com/checkout',
 * })
 *
 * // Use with paywall middleware
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
  StripePaymentMethod,
} from '@openagentpay/core'

import { FacilitatorUnavailableError } from '@openagentpay/core'

import type { StripeAdapterConfig } from './types.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** HTTP header name for Stripe payment proofs. */
const STRIPE_HEADER = 'x-stripe-session'

/** Stripe API base URL. */
const STRIPE_API_BASE = 'https://api.stripe.com/v1'

// ---------------------------------------------------------------------------
// Receipt ID Generation
// ---------------------------------------------------------------------------

/**
 * Generates a unique receipt ID with a timestamp prefix for sortability.
 * Uses a `stripe_` prefix to distinguish Stripe receipts.
 */
function generateReceiptId(): string {
  const timestamp = Date.now().toString(36).padStart(10, '0')
  const chars = '0123456789abcdefghjkmnpqrstvwxyz'
  let random = ''
  for (let i = 0; i < 16; i++) {
    random += chars[Math.floor(Math.random() * chars.length)]
  }
  return `stripe_${timestamp}${random}`
}

// ---------------------------------------------------------------------------
// Stripe PaymentIntent Response Shape
// ---------------------------------------------------------------------------

/** Minimal shape of a Stripe PaymentIntent from the API. */
interface StripePaymentIntent {
  id: string
  object: 'payment_intent'
  status: string
  amount: number
  currency: string
  metadata?: Record<string, string>
}

/** Minimal shape of a Stripe Checkout Session from the API. */
interface StripeCheckoutSession {
  id: string
  object: 'checkout.session'
  payment_status: string
  amount_total: number | null
  currency: string | null
  payment_intent: string | null
  metadata?: Record<string, string>
}

// ---------------------------------------------------------------------------
// StripeAdapter
// ---------------------------------------------------------------------------

/**
 * Server-side payment adapter for Stripe payments.
 *
 * Implements the full {@link PaymentAdapter} interface for verifying
 * Stripe PaymentIntent and Checkout Session payments.
 *
 * ## Detection
 *
 * Detects Stripe payments via the `X-STRIPE-SESSION` HTTP header.
 * The header value should be either:
 * - A PaymentIntent ID (starts with `pi_`)
 * - A Checkout Session ID (starts with `cs_`)
 *
 * ## Verification
 *
 * Calls the Stripe REST API to verify:
 * 1. The PaymentIntent/Session exists and belongs to this account
 * 2. The payment status is `succeeded` / `complete`
 * 3. The amount matches or exceeds the required pricing
 *
 * ## Amount Handling
 *
 * Stripe amounts are in the smallest currency unit (e.g. cents for USD).
 * The adapter converts between decimal strings (e.g. `"0.50"`) and
 * Stripe's integer amounts (e.g. `50`).
 *
 * @example
 * ```typescript
 * const adapter = new StripeAdapter({
 *   secretKey: 'sk_test_...',
 *   checkoutUrl: 'https://example.com/checkout',
 *   directCharge: true,
 * })
 *
 * // Detection
 * adapter.detect(req) // true if X-STRIPE-SESSION header is present
 *
 * // Verification
 * const result = await adapter.verify(req, { amount: '5.00', currency: 'usd' })
 * ```
 */
export class StripeAdapter implements PaymentAdapter {
  /** Adapter type identifier. Always `"stripe"`. */
  readonly type = 'stripe' as const

  /** Stripe secret key for API authentication. */
  private readonly secretKey: string

  /** Stripe publishable key for client-side use. */
  private readonly publishableKey?: string

  /** URL for Stripe Checkout credit purchases. */
  private readonly checkoutUrl?: string

  /** URL for setting up direct payment methods. */
  private readonly setupUrl?: string

  /** Whether direct per-call charging is supported. */
  private readonly directCharge: boolean

  /**
   * Creates a new StripeAdapter.
   *
   * @param config - Stripe adapter configuration
   */
  constructor(config: StripeAdapterConfig) {
    if (!config.secretKey) {
      throw new Error('StripeAdapter requires a secretKey')
    }
    this.secretKey = config.secretKey
    this.publishableKey = config.publishableKey
    this.checkoutUrl = config.checkoutUrl
    this.setupUrl = config.setupUrl
    this.directCharge = config.directCharge ?? false
  }

  /**
   * Detects whether the incoming request carries a Stripe payment proof.
   *
   * Checks for the `X-STRIPE-SESSION` header containing a PaymentIntent ID
   * (starts with `pi_`) or a Checkout Session ID (starts with `cs_`).
   *
   * @param req - The incoming HTTP request
   * @returns `true` if the request contains a Stripe payment header
   */
  detect(req: IncomingRequest): boolean {
    const header = this.getHeader(req, STRIPE_HEADER)
    if (typeof header !== 'string' || header.length === 0) return false
    return header.startsWith('pi_') || header.startsWith('cs_')
  }

  /**
   * Verifies a Stripe payment by calling the Stripe REST API.
   *
   * Supports both PaymentIntent IDs and Checkout Session IDs:
   * - `pi_*` — retrieves the PaymentIntent and checks status is `succeeded`
   * - `cs_*` — retrieves the Checkout Session and checks payment_status is `paid`
   *
   * The verified amount must match or exceed the required pricing amount.
   *
   * @param req - The incoming HTTP request with the `X-STRIPE-SESSION` header
   * @param pricing - The pricing requirements for this endpoint
   * @returns Verification result with optional partial receipt
   */
  async verify(req: IncomingRequest, pricing: Pricing): Promise<VerifyResult> {
    const header = this.getHeader(req, STRIPE_HEADER)
    if (!header) {
      return { valid: false, error: 'Missing X-STRIPE-SESSION header' }
    }

    try {
      if (header.startsWith('pi_')) {
        return await this.verifyPaymentIntent(header, pricing, req)
      } else if (header.startsWith('cs_')) {
        return await this.verifyCheckoutSession(header, pricing, req)
      } else {
        return { valid: false, error: 'Invalid X-STRIPE-SESSION header: must start with pi_ or cs_' }
      }
    } catch (err) {
      if (err instanceof FacilitatorUnavailableError) {
        throw err
      }
      const message = err instanceof Error ? err.message : 'Unknown error during Stripe verification'
      return { valid: false, error: message }
    }
  }

  /**
   * Generates the Stripe payment method descriptor for 402 responses.
   *
   * Returns a {@link StripePaymentMethod} that tells agents how to pay
   * via Stripe, including checkout and setup URLs.
   *
   * @param _config - Adapter configuration (URLs come from constructor)
   * @returns A StripePaymentMethod for inclusion in the 402 response
   */
  describeMethod(_config: AdapterConfig): PaymentMethod {
    const method: StripePaymentMethod = {
      type: 'stripe',
    }
    if (this.publishableKey) method.publishable_key = this.publishableKey
    if (this.checkoutUrl) method.checkout_url = this.checkoutUrl
    if (this.setupUrl) method.setup_url = this.setupUrl
    if (this.directCharge) method.direct_charge = this.directCharge
    return method
  }

  /**
   * Checks whether this adapter handles the given payment method.
   *
   * @param method - The payment method to check
   * @returns `true` if the method type is `"stripe"`
   */
  supports(method: PaymentMethod): boolean {
    return method.type === 'stripe'
  }

  /**
   * Not applicable on the server side.
   *
   * Stripe payments are initiated by clients via Checkout Sessions or
   * direct charges. Calling this method on the server adapter throws.
   *
   * @throws {Error} Always — server-side adapter cannot initiate payments
   */
  async pay(_method: PaymentMethod, _pricing: Pricing): Promise<PaymentProof> {
    throw new Error(
      'StripeAdapter.pay() is not available on the server side. ' +
      'Use Stripe Checkout or a client-side integration to initiate payments.'
    )
  }

  // ---------------------------------------------------------------------------
  // Private: PaymentIntent Verification
  // ---------------------------------------------------------------------------

  /**
   * Verifies a Stripe PaymentIntent by its ID.
   *
   * @param paymentIntentId - The PaymentIntent ID (pi_...)
   * @param pricing - Required pricing
   * @param req - Original request for receipt generation
   * @returns Verification result
   */
  private async verifyPaymentIntent(
    paymentIntentId: string,
    pricing: Pricing,
    req: IncomingRequest
  ): Promise<VerifyResult> {
    const pi = await this.stripeGet<StripePaymentIntent>(
      `/payment_intents/${paymentIntentId}`
    )

    if (pi.status !== 'succeeded') {
      return {
        valid: false,
        error: `PaymentIntent status is '${pi.status}', expected 'succeeded'`,
      }
    }

    // Convert pricing amount (decimal string) to cents
    const requiredCents = decimalToCents(pricing.amount)

    if (pi.amount < requiredCents) {
      return {
        valid: false,
        error: `Payment amount ${pi.amount} cents is less than required ${requiredCents} cents`,
      }
    }

    // Currency check (Stripe uses lowercase)
    if (pi.currency.toLowerCase() !== pricing.currency.toLowerCase()) {
      return {
        valid: false,
        error: `Currency mismatch: payment is in ${pi.currency}, required ${pricing.currency}`,
      }
    }

    return {
      valid: true,
      receipt: this.buildReceipt(
        centsToDecimal(pi.amount),
        pi.currency,
        paymentIntentId,
        pi.metadata?.payer_identifier,
        req
      ),
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Checkout Session Verification
  // ---------------------------------------------------------------------------

  /**
   * Verifies a Stripe Checkout Session by its ID.
   *
   * @param sessionId - The Checkout Session ID (cs_...)
   * @param pricing - Required pricing
   * @param req - Original request for receipt generation
   * @returns Verification result
   */
  private async verifyCheckoutSession(
    sessionId: string,
    pricing: Pricing,
    req: IncomingRequest
  ): Promise<VerifyResult> {
    const session = await this.stripeGet<StripeCheckoutSession>(
      `/checkout/sessions/${sessionId}`
    )

    if (session.payment_status !== 'paid') {
      return {
        valid: false,
        error: `Checkout Session payment_status is '${session.payment_status}', expected 'paid'`,
      }
    }

    const amountTotal = session.amount_total ?? 0
    const requiredCents = decimalToCents(pricing.amount)

    if (amountTotal < requiredCents) {
      return {
        valid: false,
        error: `Session amount ${amountTotal} cents is less than required ${requiredCents} cents`,
      }
    }

    const currency = session.currency ?? pricing.currency
    if (currency.toLowerCase() !== pricing.currency.toLowerCase()) {
      return {
        valid: false,
        error: `Currency mismatch: session is in ${currency}, required ${pricing.currency}`,
      }
    }

    return {
      valid: true,
      receipt: this.buildReceipt(
        centsToDecimal(amountTotal),
        currency,
        session.payment_intent ?? sessionId,
        session.metadata?.payer_identifier,
        req
      ),
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Stripe API Helper
  // ---------------------------------------------------------------------------

  /**
   * Makes an authenticated GET request to the Stripe REST API.
   *
   * @param path - API path (e.g. `/payment_intents/pi_...`)
   * @returns Parsed JSON response
   * @throws {FacilitatorUnavailableError} On network or API errors
   */
  private async stripeGet<T>(path: string): Promise<T> {
    let response: Response

    try {
      response = await fetch(`${STRIPE_API_BASE}${path}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to reach Stripe API: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Stripe API returned ${response.status}: ${body}`
      )
    }

    return response.json() as Promise<T>
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
        identifier: payerIdentifier ?? 'stripe-customer',
      },
      payee: {
        identifier: 'stripe-provider',
        endpoint: path,
      },
      request: {
        method,
        url: path,
      },
      payment: {
        amount,
        currency: currency.toUpperCase(),
        method: 'stripe',
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
 * Converts a decimal string (e.g. "5.00") to cents (e.g. 500).
 * Handles up to 2 decimal places of precision.
 *
 * @param amount - Decimal string amount
 * @returns Integer amount in cents
 */
function decimalToCents(amount: string): number {
  const parts = amount.split('.')
  const dollars = parseInt(parts[0] ?? '0', 10)
  const centsStr = (parts[1] ?? '00').padEnd(2, '0').slice(0, 2)
  const cents = parseInt(centsStr, 10)
  return dollars * 100 + cents
}

/**
 * Converts an integer cents amount to a decimal string.
 *
 * @param cents - Integer amount in cents
 * @returns Decimal string (e.g. "5.00")
 */
function centsToDecimal(cents: number): string {
  const dollars = Math.floor(cents / 100)
  const remainder = cents % 100
  return `${dollars}.${remainder.toString().padStart(2, '0')}`
}
