/**
 * @module credits-wallet
 *
 * Client-side credit wallet for OpenAgentPay.
 *
 * The {@link CreditsWallet} enables AI agents to pay for API calls using
 * prepaid credits. It generates the `X-CREDITS` authentication header,
 * tracks the local balance, and supports top-ups.
 *
 * The wallet maintains a local copy of the balance for fast
 * `getBalance()` queries and pre-flight insufficient-funds checks.
 * The server-side {@link CreditsAdapter} is the source of truth for
 * the actual balance — the local balance is a best-effort mirror.
 *
 * @example
 * ```typescript
 * import { creditsWallet } from '@openagentpay/adapter-credits'
 *
 * const wallet = creditsWallet({
 *   accountId: 'acct_abc123',
 *   initialBalance: '50.00',
 *   currency: 'USDC',
 * })
 *
 * // Use with the client SDK
 * const paidFetch = withPayment(fetch, { wallet })
 * const response = await paidFetch('https://api.example.com/data')
 *
 * console.log(wallet.getBalance()) // "49.99" (after a $0.01 call)
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
} from '@openagentpay/core'

import type { CreditsWalletConfig } from './types.js'

// ---------------------------------------------------------------------------
// Decimal Arithmetic Helpers (duplicated for bundle independence)
// ---------------------------------------------------------------------------

const PRECISION = 18
const SCALE = 10n ** BigInt(PRECISION)

/**
 * Converts a decimal string to a scaled BigInt.
 */
function toBigInt(value: string): bigint {
  const trimmed = value.trim()
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid decimal string: "${value}"`)
  }
  const parts = trimmed.split('.')
  const integerPart = parts[0] ?? '0'
  const fractionalPart = (parts[1] ?? '').padEnd(PRECISION, '0').slice(0, PRECISION)
  return BigInt(integerPart) * SCALE + BigInt(fractionalPart)
}

/**
 * Converts a scaled BigInt back to a decimal string.
 */
function fromBigInt(value: bigint): string {
  const isNegative = value < 0n
  const abs = isNegative ? -value : value
  const integerPart = abs / SCALE
  const fractionalPart = abs % SCALE
  const fracStr = fractionalPart.toString().padStart(PRECISION, '0')
  let trimmed = fracStr.replace(/0+$/, '')
  if (trimmed.length < 2) {
    trimmed = fracStr.slice(0, 2)
  }
  const sign = isNegative ? '-' : ''
  return `${sign}${integerPart}.${trimmed}`
}

// ---------------------------------------------------------------------------
// CreditsWallet
// ---------------------------------------------------------------------------

/**
 * Client-side wallet for paying with prepaid credits.
 *
 * Implements the {@link PaymentAdapter} interface so it can be used
 * interchangeably with other adapters in the client SDK. The server-side
 * methods (`detect`, `verify`) throw errors since they are not applicable
 * on the client.
 *
 * ## How Payment Works
 *
 * When `pay()` is called:
 * 1. The wallet checks if the local balance is sufficient
 * 2. The payment amount is deducted from the local balance
 * 3. An `X-CREDITS` header is generated with `account_id:signature`
 * 4. The header is returned as a {@link PaymentProof}
 *
 * The server then independently verifies and deducts from the
 * authoritative credit store. The local balance is a convenience
 * mirror — if it drifts, the server is always correct.
 *
 * ## Balance Management
 *
 * - {@link getBalance} returns the current local balance
 * - {@link topUp} adds to the local balance (should mirror a server-side top-up)
 *
 * @example
 * ```typescript
 * const wallet = new CreditsWallet({
 *   accountId: 'acct_abc123',
 *   initialBalance: '100.00',
 * })
 *
 * const proof = await wallet.pay(method, { amount: '0.01', currency: 'USDC' })
 * // proof.header === 'X-CREDITS'
 * // proof.value === 'acct_abc123:acct_abc123'
 *
 * console.log(wallet.getBalance()) // "99.99"
 * ```
 */
export class CreditsWallet implements PaymentAdapter {
  /** Adapter type identifier. Always `"credits"`. */
  readonly type = 'credits' as const

  /** The credit account ID. */
  private readonly accountId: string

  /** The currency this wallet operates in. */
  private readonly currency: string

  /** Current local balance as a scaled BigInt. */
  private balance: bigint

  /**
   * Creates a new CreditsWallet.
   *
   * @param config - Wallet configuration
   * @param config.accountId - The credit account identifier
   * @param config.initialBalance - Starting balance as a decimal string
   * @param config.currency - Currency code (default: `"USDC"`)
   */
  constructor(config: CreditsWalletConfig) {
    this.accountId = config.accountId
    this.currency = (config.currency ?? 'USDC').toUpperCase()
    this.balance = toBigInt(config.initialBalance)
  }

  /**
   * Returns the current local credit balance as a decimal string.
   *
   * This is a local mirror of the server-side balance. It decrements
   * with each `pay()` call and increments with each `topUp()` call.
   *
   * @returns The current balance (e.g. `"99.50"`)
   */
  getBalance(): string {
    return fromBigInt(this.balance)
  }

  /**
   * Adds credits to the local balance.
   *
   * Call this after a successful server-side top-up to keep the local
   * balance in sync. The server-side credit store is the authoritative
   * source of truth.
   *
   * @param amount - The amount to add as a decimal string
   * @throws {Error} If the amount is not positive
   *
   * @example
   * ```typescript
   * wallet.topUp('50.00')
   * console.log(wallet.getBalance()) // balance increased by 50.00
   * ```
   */
  topUp(amount: string): void {
    const topUpAmount = toBigInt(amount)
    if (topUpAmount <= 0n) {
      throw new Error(`Top-up amount must be positive, got: ${amount}`)
    }
    this.balance += topUpAmount
  }

  /**
   * Execute a credit payment and return the proof header.
   *
   * Deducts the payment amount from the local balance and generates
   * an `X-CREDITS` header with the account credentials.
   *
   * @param _method - The payment method (must be type `"credits"`)
   * @param pricing - The pricing requirements
   * @returns A payment proof with the `X-CREDITS` header
   * @throws {Error} If the local balance is insufficient
   *
   * @example
   * ```typescript
   * const proof = await wallet.pay(method, { amount: '0.01', currency: 'USDC' })
   * // Attach proof.header and proof.value to the retry request
   * ```
   */
  async pay(_method: PaymentMethod, pricing: Pricing): Promise<PaymentProof> {
    const paymentAmount = toBigInt(pricing.amount)

    if (paymentAmount <= 0n) {
      throw new Error(`Payment amount must be positive, got: ${pricing.amount}`)
    }

    if (this.balance < paymentAmount) {
      const currentBalance = fromBigInt(this.balance)
      throw new Error(
        `Insufficient credit balance. Current: $${currentBalance}, Required: $${pricing.amount}`
      )
    }

    // Deduct from local balance
    this.balance -= paymentAmount

    // Generate the v1 credential: account_id:account_id
    const signature = this.accountId
    const headerValue = `${this.accountId}:${signature}`

    return {
      header: 'X-CREDITS',
      value: headerValue,
    }
  }

  /**
   * Checks whether this wallet can handle the given payment method.
   *
   * @param method - The payment method to check
   * @returns `true` if the method type is `"credits"`
   */
  supports(method: PaymentMethod): boolean {
    return method.type === 'credits'
  }

  /**
   * Not applicable on the client side.
   *
   * Detection is a server-side concern. This method always returns `false`.
   *
   * @param _req - The incoming request (ignored)
   * @returns Always `false`
   */
  detect(_req: IncomingRequest): boolean {
    return false
  }

  /**
   * Not applicable on the client side.
   *
   * Verification is a server-side concern. This method throws an error.
   *
   * @throws {Error} Always — use CreditsAdapter for server-side verification
   */
  async verify(_req: IncomingRequest, _pricing: Pricing): Promise<VerifyResult> {
    throw new Error(
      'CreditsWallet.verify() is not available on the client side. ' +
      'Use CreditsAdapter for server-side payment verification.'
    )
  }

  /**
   * Not applicable on the client side.
   *
   * Method description is a server-side concern. This method throws an error.
   *
   * @throws {Error} Always — use CreditsAdapter for server-side method description
   */
  describeMethod(_config: AdapterConfig): PaymentMethod {
    throw new Error(
      'CreditsWallet.describeMethod() is not available on the client side. ' +
      'Use CreditsAdapter for server-side payment method description.'
    )
  }
}
