/**
 * @module mock-adapter
 *
 * Server-side mock payment adapter for OpenAgentPay.
 *
 * The MockAdapter simulates payment verification so developers can test
 * the full paywall flow — 402 responses, payment headers, receipt generation —
 * without connecting to a real blockchain or credit system.
 *
 * Think of it like Stripe's test mode: everything behaves identically to
 * production, but no real money moves.
 *
 * @example
 * ```ts
 * import { mock } from '@openagentpay/adapter-mock'
 *
 * const paywall = createPaywall({
 *   adapters: [mock()],
 *   recipient: '0xTestRecipient',
 * })
 * ```
 */

import type {
  PaymentAdapter,
  VerifyResult,
  PaymentProof,
  Pricing,
  PaymentMethod,
  AgentPaymentReceipt,
} from '@openagentpay/core'

/** Configuration options for the mock adapter. */
export interface MockAdapterOptions {
  /**
   * Whether to log payment events to the console.
   * Useful during development to see the payment flow in action.
   * @default true
   */
  logging?: boolean
}

/**
 * Generates a realistic-looking mock transaction hash.
 * Mimics the format of an Ethereum transaction hash (66 hex characters).
 */
function generateMockTransactionHash(): string {
  const chars = '0123456789abcdef'
  let hash = '0x'
  for (let i = 0; i < 64; i++) {
    hash += chars[Math.floor(Math.random() * chars.length)]
  }
  return hash
}

/**
 * Generates a unique receipt ID in ULID-like format.
 * Uses a timestamp prefix for sortability followed by random characters.
 */
function generateReceiptId(): string {
  const timestamp = Date.now().toString(36).padStart(10, '0')
  const chars = '0123456789abcdefghjkmnpqrstvwxyz'
  let random = ''
  for (let i = 0; i < 16; i++) {
    random += chars[Math.floor(Math.random() * chars.length)]
  }
  return `rcpt_${timestamp}${random}`
}

/**
 * Generates a random nonce for mock payment proofs.
 * Uses URL-safe base64-like characters for compatibility with HTTP headers.
 */
function generateNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let nonce = ''
  for (let i = 0; i < 32; i++) {
    nonce += chars[Math.floor(Math.random() * chars.length)]
  }
  return nonce
}

/**
 * A minimal request interface for adapter detection and verification.
 * Compatible with Express, Hono, and other Node.js HTTP frameworks.
 */
interface IncomingRequest {
  headers: Record<string, string | string[] | undefined>
  method?: string
  url?: string
  path?: string
}

/**
 * Server-side mock payment adapter.
 *
 * Implements the full {@link PaymentAdapter} interface with simulated
 * behavior. Every payment is automatically verified as valid, and
 * realistic-looking receipts are generated for each transaction.
 *
 * This adapter detects payments via the `X-PAYMENT` header with a
 * `mock:` prefix. Any value matching that pattern is accepted.
 *
 * @example
 * ```ts
 * const adapter = new MockAdapter({ logging: true })
 *
 * // Detection
 * adapter.detect(req) // true if X-PAYMENT starts with "mock:"
 *
 * // Verification — always succeeds
 * const result = await adapter.verify(req, pricing)
 * // { valid: true, receipt: { ... } }
 * ```
 */
export class MockAdapter implements PaymentAdapter {
  /** Adapter type identifier. Always `"mock"`. */
  readonly type = 'mock' as const

  private readonly logging: boolean

  constructor(options: MockAdapterOptions = {}) {
    this.logging = options.logging ?? true
  }

  /**
   * Detects whether the incoming request contains a mock payment proof.
   *
   * Checks for the `X-PAYMENT` header with a value that starts with `mock:`.
   * This is the same header used by production adapters, ensuring the
   * test flow mirrors real behavior exactly.
   *
   * @param req - The incoming HTTP request
   * @returns `true` if the request carries a mock payment proof
   */
  detect(req: IncomingRequest): boolean {
    const header = this.getHeader(req, 'x-payment')
    return typeof header === 'string' && header.startsWith('mock:')
  }

  /**
   * Verifies a mock payment and generates a receipt.
   *
   * Unlike production adapters that validate signatures, check balances,
   * or call facilitator APIs, the mock adapter always returns `{ valid: true }`.
   * This lets you test the full middleware flow — including receipt generation,
   * event emission, and response headers — without any external dependencies.
   *
   * The generated receipt contains realistic-looking data:
   * - A mock Ethereum transaction hash
   * - The correct amount and currency from the pricing config
   * - Accurate timestamps
   * - A unique, sortable receipt ID
   *
   * @param req - The incoming HTTP request with payment proof
   * @param pricing - The pricing requirements for this endpoint
   * @returns A verification result that is always valid, with a partial receipt
   */
  async verify(req: IncomingRequest, pricing: Pricing): Promise<VerifyResult> {
    const paymentHeader = this.getHeader(req, 'x-payment') ?? ''
    const nonce = paymentHeader.replace(/^mock:/, '')
    const path = req.path ?? req.url ?? '/unknown'
    const method = req.method ?? 'GET'
    const now = new Date().toISOString()

    const receipt: Partial<AgentPaymentReceipt> = {
      id: generateReceiptId(),
      version: '1.0',
      timestamp: now,
      payer: {
        type: 'agent',
        identifier: `mock-agent-${nonce.slice(0, 8)}`,
      },
      payee: {
        identifier: 'mock-recipient',
        endpoint: path,
      },
      request: {
        method,
        url: path,
      },
      payment: {
        amount: pricing.amount,
        currency: pricing.currency,
        method: 'mock',
        transaction_hash: generateMockTransactionHash(),
        network: 'mock-network',
        status: 'settled',
      },
    }

    if (this.logging) {
      console.log(
        `[openagentpay:mock] Payment verified: $${pricing.amount} for ${path}`
      )
    }

    return {
      valid: true,
      receipt,
    }
  }

  /**
   * Generates the payment method descriptor for 402 responses.
   *
   * Returns a {@link PaymentMethod} that describes mock payment support.
   * This is included in the 402 response body so client-side wallets
   * know how to construct a payment proof.
   *
   * @param _config - Adapter configuration (unused by mock adapter)
   * @returns A PaymentMethod describing mock payment support
   */
  describeMethod(_config: Record<string, unknown> = {}): PaymentMethod {
    return {
      type: 'mock',
      description: 'Mock payment for testing — no real money is transferred',
    } as unknown as PaymentMethod
  }

  /**
   * Checks if this adapter can handle the given payment method.
   *
   * The mock adapter returns `true` for **any** payment method type.
   * This is intentional — during testing, you want the mock adapter to
   * handle all payment flows regardless of the method type advertised
   * by the server.
   *
   * @param _method - The payment method to check
   * @returns Always `true`
   */
  supports(_method: PaymentMethod): boolean {
    return true
  }

  /**
   * Executes a mock payment for client-side use.
   *
   * Generates a {@link PaymentProof} containing the `X-PAYMENT` header
   * with a `mock:` prefixed nonce. This proof is attached to the retry
   * request after receiving a 402 response.
   *
   * @param _method - The payment method (accepted but unused)
   * @param _pricing - The pricing requirements (accepted but unused)
   * @returns A payment proof with the X-PAYMENT header
   */
  async pay(_method: PaymentMethod, _pricing: Pricing): Promise<PaymentProof> {
    return {
      header: 'X-PAYMENT',
      value: `mock:${generateNonce()}`,
    }
  }

  /**
   * Extracts a header value from the request, handling case-insensitive lookup
   * and array-valued headers.
   */
  private getHeader(req: IncomingRequest, name: string): string | undefined {
    const headers = req.headers
    // Try exact match first, then lowercase
    const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()]
    if (Array.isArray(value)) {
      return value[0]
    }
    return value ?? undefined
  }
}
