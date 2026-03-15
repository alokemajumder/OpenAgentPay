/**
 * @module credit-store
 *
 * The credit store abstraction and a built-in in-memory implementation.
 *
 * The {@link CreditStore} interface defines the persistence contract for
 * credit account management. Any backing store — in-memory, Redis, PostgreSQL,
 * DynamoDB — can implement this interface to plug into the credits adapter.
 *
 * The {@link InMemoryCreditStore} is provided for development, testing, and
 * lightweight deployments where durability is not required.
 *
 * @example
 * ```typescript
 * import { InMemoryCreditStore } from '@openagentpay/adapter-credits'
 *
 * const store = new InMemoryCreditStore()
 * const account = await store.createAccount('acct_1', '100.00', 'USDC')
 * const result = await store.deduct('acct_1', '0.50', 'USDC')
 * console.log(result.newBalance) // "99.50"
 * ```
 */

import type { CreditAccount } from './types.js'

// ---------------------------------------------------------------------------
// CreditStore Interface
// ---------------------------------------------------------------------------

/**
 * Persistence interface for credit account management.
 *
 * Implementations must ensure that {@link deduct} is atomic — the balance
 * check and decrement must happen as a single operation to prevent
 * double-spending from concurrent requests.
 *
 * All monetary amounts are represented as decimal strings to avoid
 * floating-point precision issues.
 */
export interface CreditStore {
  /**
   * Retrieve an account by ID.
   *
   * @param id - The account identifier
   * @returns The account if it exists, or `null` if not found
   */
  getAccount(id: string): Promise<CreditAccount | null>

  /**
   * Atomically deduct an amount from an account's balance.
   *
   * The implementation must:
   * 1. Look up the account
   * 2. Verify the currency matches
   * 3. Verify sufficient balance
   * 4. Deduct the amount
   *
   * Steps 2-4 must be atomic — no other deduction can interleave
   * between the balance check and the decrement.
   *
   * @param id - The account identifier
   * @param amount - The amount to deduct as a decimal string
   * @param currency - The expected currency (must match the account's currency)
   * @returns A result indicating success or failure with the new balance
   */
  deduct(
    id: string,
    amount: string,
    currency: string
  ): Promise<{ success: boolean; newBalance: string; error?: string }>

  /**
   * Add credits to an existing account.
   *
   * @param id - The account identifier
   * @param amount - The amount to add as a decimal string
   * @returns The updated account
   * @throws If the account does not exist
   */
  topUp(id: string, amount: string): Promise<CreditAccount>

  /**
   * Create a new credit account with an initial balance.
   *
   * @param id - The account identifier (must be unique)
   * @param initialBalance - Starting balance as a decimal string
   * @param currency - Currency code or token symbol
   * @returns The newly created account
   * @throws If an account with the given ID already exists
   */
  createAccount(
    id: string,
    initialBalance: string,
    currency: string
  ): Promise<CreditAccount>
}

// ---------------------------------------------------------------------------
// Decimal Arithmetic Helpers
// ---------------------------------------------------------------------------

/**
 * Parses a decimal string into an integer count of the smallest unit,
 * using a fixed precision of 18 decimal places. This avoids all
 * floating-point issues by working entirely with BigInt.
 */
const PRECISION = 18
const SCALE = 10n ** BigInt(PRECISION)

/**
 * Converts a decimal string to a scaled BigInt.
 * E.g. "1.50" -> 1500000000000000000n (with 18 decimals of precision).
 *
 * @param value - Decimal string (e.g. "1.50", "0.001", "100")
 * @returns Scaled BigInt representation
 * @throws If the value is not a valid non-negative decimal string
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
 * Trims trailing zeros but preserves at least two decimal places.
 *
 * @param value - Scaled BigInt
 * @returns Decimal string (e.g. "1.50", "0.00")
 */
function fromBigInt(value: bigint): string {
  const isNegative = value < 0n
  const abs = isNegative ? -value : value

  const integerPart = abs / SCALE
  const fractionalPart = abs % SCALE

  const fracStr = fractionalPart.toString().padStart(PRECISION, '0')

  // Trim trailing zeros, but keep at least 2 decimal places
  let trimmed = fracStr.replace(/0+$/, '')
  if (trimmed.length < 2) {
    trimmed = fracStr.slice(0, 2)
  }

  const sign = isNegative ? '-' : ''
  return `${sign}${integerPart}.${trimmed}`
}

// ---------------------------------------------------------------------------
// InMemoryCreditStore
// ---------------------------------------------------------------------------

/**
 * In-memory implementation of {@link CreditStore}.
 *
 * Uses a `Map` for storage and BigInt-based decimal arithmetic for
 * precision. All operations are synchronous under the hood (wrapped
 * in Promises for interface compatibility), which means deductions
 * are naturally atomic in single-threaded JavaScript.
 *
 * For concurrent promise scenarios, the synchronous check-and-deduct
 * pattern ensures no double-spending — JavaScript's event loop
 * guarantees that the synchronous portion of each `deduct()` call
 * runs to completion before yielding.
 *
 * **Not suitable for production multi-process deployments.** Use a
 * database-backed store with row-level locking or compare-and-swap
 * for production.
 *
 * @example
 * ```typescript
 * const store = new InMemoryCreditStore()
 *
 * // Create an account with $100
 * await store.createAccount('agent-1', '100.00', 'USDC')
 *
 * // Deduct $0.50
 * const { success, newBalance } = await store.deduct('agent-1', '0.50', 'USDC')
 * console.log(success)    // true
 * console.log(newBalance) // "99.50"
 *
 * // Top up $20
 * const updated = await store.topUp('agent-1', '20.00')
 * console.log(updated.balance) // "119.50"
 * ```
 */
export class InMemoryCreditStore implements CreditStore {
  /** Internal account storage keyed by account ID. */
  private readonly accounts = new Map<string, CreditAccount>()

  /**
   * Retrieve an account by ID.
   *
   * @param id - The account identifier
   * @returns A copy of the account, or `null` if not found
   */
  async getAccount(id: string): Promise<CreditAccount | null> {
    const account = this.accounts.get(id)
    if (!account) return null
    // Return a defensive copy to prevent external mutation
    return { ...account, metadata: account.metadata ? { ...account.metadata } : undefined }
  }

  /**
   * Atomically deduct an amount from an account's balance.
   *
   * The entire check-and-deduct runs synchronously before the first
   * `await` boundary, ensuring atomicity in single-threaded JS.
   *
   * @param id - The account identifier
   * @param amount - The amount to deduct as a decimal string
   * @param currency - The expected currency
   * @returns Deduction result with success flag and new balance
   */
  async deduct(
    id: string,
    amount: string,
    currency: string
  ): Promise<{ success: boolean; newBalance: string; error?: string }> {
    // --- Synchronous atomic section begins ---
    const account = this.accounts.get(id)

    if (!account) {
      return {
        success: false,
        newBalance: '0.00',
        error: `Account not found: ${id}`,
      }
    }

    if (account.currency.toUpperCase() !== currency.toUpperCase()) {
      return {
        success: false,
        newBalance: account.balance,
        error: `Currency mismatch: account uses ${account.currency}, payment requires ${currency}`,
      }
    }

    const currentBalance = toBigInt(account.balance)
    const deductAmount = toBigInt(amount)

    if (deductAmount <= 0n) {
      return {
        success: false,
        newBalance: account.balance,
        error: `Deduction amount must be positive, got: ${amount}`,
      }
    }

    if (currentBalance < deductAmount) {
      return {
        success: false,
        newBalance: account.balance,
        error: `Insufficient credit balance. Current: $${account.balance}, Required: $${amount}`,
      }
    }

    const newBalance = fromBigInt(currentBalance - deductAmount)
    account.balance = newBalance
    // --- Synchronous atomic section ends ---

    return {
      success: true,
      newBalance,
    }
  }

  /**
   * Add credits to an existing account.
   *
   * @param id - The account identifier
   * @param amount - The amount to add as a decimal string
   * @returns The updated account (defensive copy)
   * @throws {Error} If the account does not exist
   * @throws {Error} If the amount is not positive
   */
  async topUp(id: string, amount: string): Promise<CreditAccount> {
    const account = this.accounts.get(id)
    if (!account) {
      throw new Error(`Cannot top up non-existent account: ${id}`)
    }

    const topUpAmount = toBigInt(amount)
    if (topUpAmount <= 0n) {
      throw new Error(`Top-up amount must be positive, got: ${amount}`)
    }

    const currentBalance = toBigInt(account.balance)
    account.balance = fromBigInt(currentBalance + topUpAmount)

    return { ...account, metadata: account.metadata ? { ...account.metadata } : undefined }
  }

  /**
   * Create a new credit account with an initial balance.
   *
   * @param id - Unique account identifier
   * @param initialBalance - Starting balance as a decimal string
   * @param currency - Currency code or token symbol
   * @returns The newly created account
   * @throws {Error} If an account with the given ID already exists
   * @throws {Error} If the initial balance is negative
   */
  async createAccount(
    id: string,
    initialBalance: string,
    currency: string
  ): Promise<CreditAccount> {
    if (this.accounts.has(id)) {
      throw new Error(`Account already exists: ${id}`)
    }

    const balance = toBigInt(initialBalance)
    if (balance < 0n) {
      throw new Error(`Initial balance cannot be negative, got: ${initialBalance}`)
    }

    const account: CreditAccount = {
      id,
      balance: fromBigInt(balance),
      currency: currency.toUpperCase(),
      createdAt: new Date().toISOString(),
    }

    this.accounts.set(id, account)

    return { ...account }
  }
}
