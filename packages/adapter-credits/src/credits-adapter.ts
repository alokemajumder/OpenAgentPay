/**
 * @module credits-adapter
 *
 * Server-side prepaid credits payment adapter for OpenAgentPay.
 *
 * The {@link CreditsAdapter} enables API providers to accept credit-based
 * payments. Agents purchase credits upfront (via a purchase URL), then
 * spend them per-call by including an `X-CREDITS` header with their
 * account ID and signature.
 *
 * This is the fastest payment method in OpenAgentPay — no on-chain
 * transactions, no facilitator round-trips. The credit store deducts
 * the balance atomically and the request proceeds immediately.
 *
 * @example
 * ```typescript
 * import { credits, InMemoryCreditStore } from '@openagentpay/adapter-credits'
 *
 * const store = new InMemoryCreditStore()
 * await store.createAccount('agent-1', '100.00', 'USDC')
 *
 * const paywall = createPaywall({
 *   adapters: [credits({ store })],
 *   recipient: 'provider-wallet',
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
  CreditsPaymentMethod,
} from '@openagentpay/core'

import type { CreditStore } from './credit-store.js'
import type { CreditsAdapterConfig } from './types.js'

// ---------------------------------------------------------------------------
// Header Constants
// ---------------------------------------------------------------------------

/** The HTTP header name used for credit-based payment proofs. */
const CREDITS_HEADER = 'x-credits'

/** Default URL for purchasing credits (placeholder). */
const DEFAULT_PURCHASE_URL = 'https://credits.openagentpay.com/purchase'

/** Default URL for checking credit balance (placeholder). */
const DEFAULT_BALANCE_URL = 'https://credits.openagentpay.com/balance'

// ---------------------------------------------------------------------------
// Receipt ID Generation
// ---------------------------------------------------------------------------

/**
 * Generates a unique receipt ID with a timestamp prefix for sortability.
 * Uses a `cred_` prefix to distinguish credit receipts from other types.
 */
function generateReceiptId(): string {
  const timestamp = Date.now().toString(36).padStart(10, '0')
  const chars = '0123456789abcdefghjkmnpqrstvwxyz'
  let random = ''
  for (let i = 0; i < 16; i++) {
    random += chars[Math.floor(Math.random() * chars.length)]
  }
  return `cred_${timestamp}${random}`
}

// ---------------------------------------------------------------------------
// CreditsAdapter
// ---------------------------------------------------------------------------

/**
 * Server-side payment adapter for prepaid credit balances.
 *
 * Implements the full {@link PaymentAdapter} interface. On the server side,
 * this adapter:
 *
 * 1. **Detects** credit payments via the `X-CREDITS` header
 * 2. **Verifies** payments by checking the credit store for sufficient balance
 * 3. **Deducts** the amount atomically from the account
 * 4. **Describes** the credit payment method for 402 responses
 *
 * The `pay()` method throws on the server side — credit payments are
 * initiated by clients using a {@link CreditsWallet}, not by the server.
 *
 * ## Authentication (v1)
 *
 * In v1, the `X-CREDITS` header format is `account_id:signature` where
 * the "signature" is simply the `account_id` repeated. This is a
 * simplified authentication scheme for initial development. A proper
 * HMAC-based signature will be introduced in v2.
 *
 * ## Header Format
 *
 * ```
 * X-CREDITS: acct_abc123:acct_abc123
 * ```
 *
 * @example
 * ```typescript
 * const adapter = new CreditsAdapter({
 *   store: new InMemoryCreditStore(),
 *   purchaseUrl: 'https://example.com/buy-credits',
 *   balanceUrl: 'https://example.com/balance',
 * })
 *
 * // Detection
 * adapter.detect(req) // true if X-CREDITS header is present
 *
 * // Verification
 * const result = await adapter.verify(req, { amount: '0.01', currency: 'USDC' })
 * // { valid: true, receipt: { ... } }  or  { valid: false, error: '...' }
 * ```
 */
export class CreditsAdapter implements PaymentAdapter {
  /** Adapter type identifier. Always `"credits"`. */
  readonly type = 'credits' as const

  /** The credit store backing this adapter. */
  private readonly store: CreditStore

  /** URL where agents can purchase credits. */
  private readonly purchaseUrl: string

  /** URL where agents can query their balance. */
  private readonly balanceUrl: string

  /**
   * Creates a new CreditsAdapter.
   *
   * @param config - Adapter configuration including the credit store
   */
  constructor(config: CreditsAdapterConfig) {
    this.store = config.store
    this.purchaseUrl = config.purchaseUrl ?? DEFAULT_PURCHASE_URL
    this.balanceUrl = config.balanceUrl ?? DEFAULT_BALANCE_URL
  }

  /**
   * Detects whether the incoming request carries a credit payment proof.
   *
   * Checks for the `X-CREDITS` header containing an `account_id:signature`
   * value. The header must contain at least one colon to be considered valid.
   *
   * @param req - The incoming HTTP request
   * @returns `true` if the request contains a credit payment header
   */
  detect(req: IncomingRequest): boolean {
    const header = this.getHeader(req, CREDITS_HEADER)
    if (typeof header !== 'string' || header.length === 0) return false
    // Must contain at least one colon separating account_id and signature
    return header.includes(':')
  }

  /**
   * Verifies a credit payment by checking and deducting the balance.
   *
   * This method performs the following steps:
   * 1. Parse the `X-CREDITS` header as `account_id:signature`
   * 2. Validate the signature (v1: signature must equal account_id)
   * 3. Look up the account in the credit store
   * 4. Verify the currency matches
   * 5. Atomically deduct the payment amount
   * 6. Generate a partial receipt with credit-specific metadata
   *
   * If any step fails, the method returns `{ valid: false }` with a
   * descriptive error message — no balance is deducted on failure.
   *
   * @param req - The incoming HTTP request with the `X-CREDITS` header
   * @param pricing - The pricing requirements for this endpoint
   * @returns Verification result with optional partial receipt
   */
  async verify(req: IncomingRequest, pricing: Pricing): Promise<VerifyResult> {
    const header = this.getHeader(req, CREDITS_HEADER)
    if (!header) {
      return { valid: false, error: 'Missing X-CREDITS header' }
    }

    // Parse "account_id:signature"
    const colonIndex = header.indexOf(':')
    if (colonIndex === -1) {
      return { valid: false, error: 'Invalid X-CREDITS header format. Expected: account_id:signature' }
    }

    const accountId = header.slice(0, colonIndex)
    const signature = header.slice(colonIndex + 1)

    if (!accountId || !signature) {
      return { valid: false, error: 'Invalid X-CREDITS header: account_id and signature must not be empty' }
    }

    // v1 authentication: signature must equal account_id
    if (signature !== accountId) {
      return { valid: false, error: 'Invalid credential signature' }
    }

    // Atomically deduct from the credit store
    const result = await this.store.deduct(accountId, pricing.amount, pricing.currency)

    if (!result.success) {
      return {
        valid: false,
        error: result.error ?? 'Credit deduction failed',
      }
    }

    // Build the partial receipt
    const path = req.url ?? '/unknown'
    const method = req.method ?? 'GET'
    const now = new Date().toISOString()

    const receipt: Partial<AgentPaymentReceipt> = {
      id: generateReceiptId(),
      version: '1.0',
      timestamp: now,
      payer: {
        type: 'agent',
        identifier: accountId,
      },
      payee: {
        identifier: 'credit-provider',
        endpoint: path,
      },
      request: {
        method,
        url: path,
      },
      payment: {
        amount: pricing.amount,
        currency: pricing.currency,
        method: 'credits',
        status: 'settled',
      },
    }

    return {
      valid: true,
      receipt,
    }
  }

  /**
   * Generates the credit payment method descriptor for 402 responses.
   *
   * Returns a {@link CreditsPaymentMethod} that tells agents how to
   * pay with credits — including URLs for purchasing credits and
   * checking their balance.
   *
   * @param _config - Adapter configuration (purchase/balance URLs come from constructor)
   * @returns A CreditsPaymentMethod for inclusion in the 402 response
   */
  describeMethod(_config: AdapterConfig): PaymentMethod {
    const method: CreditsPaymentMethod = {
      type: 'credits',
      purchase_url: this.purchaseUrl,
      balance_url: this.balanceUrl,
    }
    return method
  }

  /**
   * Checks whether this adapter handles the given payment method.
   *
   * @param method - The payment method to check
   * @returns `true` if the method type is `"credits"`
   */
  supports(method: PaymentMethod): boolean {
    return method.type === 'credits'
  }

  /**
   * Not applicable on the server side.
   *
   * Credit payments are initiated by clients using a {@link CreditsWallet}.
   * Calling this method on the server adapter throws an error.
   *
   * @throws {Error} Always — use CreditsWallet for client-side payments
   */
  async pay(_method: PaymentMethod, _pricing: Pricing): Promise<PaymentProof> {
    throw new Error(
      'CreditsAdapter.pay() is not available on the server side. ' +
      'Use CreditsWallet for client-side credit payments.'
    )
  }

  /**
   * Extracts a header value from the request, handling case-insensitive
   * lookup and array-valued headers.
   *
   * @param req - The incoming request
   * @param name - The header name (lowercase)
   * @returns The header value, or `undefined` if not present
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
