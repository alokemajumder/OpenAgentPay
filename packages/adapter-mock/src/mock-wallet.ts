/**
 * @module mock-wallet
 *
 * Client-side mock wallet for OpenAgentPay.
 *
 * The MockWallet simulates an agent's payment capability during development
 * and testing. It generates mock payment proofs, tracks a fake balance, and
 * records every payment for test assertions.
 *
 * Like Stripe's test cards, the MockWallet lets you exercise the full
 * client-side payment flow — 402 detection, policy checks, payment execution,
 * and receipt collection — without any real funds at risk.
 *
 * @example
 * ```ts
 * import { mockWallet } from '@openagentpay/adapter-mock'
 *
 * const wallet = mockWallet({ initialBalance: '500.00' })
 *
 * const paidFetch = withPayment(fetch, {
 *   wallet,
 *   policy: { maxPerRequest: '1.00' },
 * })
 *
 * // After some requests...
 * console.log(wallet.getPaymentHistory())
 * // [{ method: { type: 'mock' }, pricing: { amount: '0.01', ... }, nonce: '...', timestamp: '...' }]
 * ```
 */

import type {
  PaymentMethod,
  PaymentProof,
  Pricing,
} from '@openagentpay/core'

/** Configuration options for the mock wallet. */
export interface MockWalletOptions {
  /**
   * Starting balance for the mock wallet, as a decimal string.
   * The wallet tracks balance deductions so you can test insufficient-funds
   * scenarios by setting a low initial balance.
   * @default "1000.00"
   */
  initialBalance?: string
}

/** A record of a single payment made through the mock wallet. */
export interface MockPaymentRecord {
  /** The payment method that was used */
  method: PaymentMethod
  /** The pricing that was paid */
  pricing: Pricing
  /** The nonce generated for this payment */
  nonce: string
  /** ISO 8601 timestamp of when the payment was made */
  timestamp: string
  /** The payment proof that was returned */
  proof: PaymentProof
}

/**
 * Generates a random nonce for mock payment proofs.
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
 * Client-side mock wallet for testing agent payment flows.
 *
 * The MockWallet maintains a simulated balance and records every payment
 * made during the session. This is useful for:
 *
 * - **Integration tests:** Assert that your agent made the expected payments
 * - **Balance testing:** Verify behavior when funds are insufficient
 * - **Flow validation:** Confirm the full 402 → pay → retry cycle works
 *
 * The wallet supports any payment method type — just like the mock adapter,
 * it accepts everything so you can test all flows without real infrastructure.
 *
 * @example
 * ```ts
 * const wallet = new MockWallet({ initialBalance: '10.00' })
 *
 * // Make a payment
 * const proof = await wallet.pay(method, { amount: '0.50', currency: 'USDC', unit: 'per_request' })
 * // proof.header === 'X-PAYMENT'
 * // proof.value === 'mock:<nonce>'
 *
 * // Check balance
 * wallet.getBalance() // '9.50'
 *
 * // Review history
 * wallet.getPaymentHistory() // [{ method, pricing, nonce, timestamp, proof }]
 * ```
 */
export class MockWallet {
  private balance: number
  private readonly history: MockPaymentRecord[] = []

  constructor(options: MockWalletOptions = {}) {
    const initial = options.initialBalance ?? '1000.00'
    this.balance = Number.parseFloat(initial)

    if (Number.isNaN(this.balance) || this.balance < 0) {
      throw new Error(
        `[openagentpay:mock] Invalid initial balance: "${initial}". Must be a non-negative decimal string.`
      )
    }
  }

  /**
   * Executes a mock payment and returns a proof to attach to the request.
   *
   * This method:
   * 1. Deducts the payment amount from the simulated balance
   * 2. Generates a unique nonce for the payment
   * 3. Records the payment in the session history
   * 4. Returns a {@link PaymentProof} with the `X-PAYMENT` header
   *
   * If the wallet has insufficient balance, the payment is rejected with
   * an error — mirroring the behavior of real wallet implementations.
   *
   * @param method - The payment method advertised by the server
   * @param pricing - The pricing requirements from the 402 response
   * @returns A payment proof containing the X-PAYMENT header and mock nonce
   * @throws Error if the wallet balance is insufficient
   */
  async pay(method: PaymentMethod, pricing: Pricing): Promise<PaymentProof> {
    const amount = Number.parseFloat(pricing.amount)

    if (Number.isNaN(amount) || amount < 0) {
      throw new Error(
        `[openagentpay:mock] Invalid payment amount: "${pricing.amount}"`
      )
    }

    if (amount > this.balance) {
      throw new Error(
        `[openagentpay:mock] Insufficient balance. ` +
        `Required: ${pricing.amount} ${pricing.currency}, ` +
        `Available: ${this.balance.toFixed(2)} ${pricing.currency}`
      )
    }

    this.balance -= amount

    const nonce = generateNonce()
    const proof: PaymentProof = {
      header: 'X-PAYMENT',
      value: `mock:${nonce}`,
    }

    this.history.push({
      method,
      pricing,
      nonce,
      timestamp: new Date().toISOString(),
      proof,
    })

    return proof
  }

  /**
   * Checks if this wallet can handle the given payment method.
   *
   * The mock wallet returns `true` for **any** payment method type,
   * allowing you to test all payment flows regardless of the method
   * advertised by the server.
   *
   * @param _method - The payment method to check
   * @returns Always `true`
   */
  supports(_method: PaymentMethod): boolean {
    return true
  }

  /**
   * Returns the complete payment history for this session.
   *
   * Each record includes the payment method, pricing, nonce, timestamp,
   * and the proof that was returned. Use this in test assertions to
   * verify your agent made the expected payments.
   *
   * @returns An array of all payments made through this wallet, in order
   */
  getPaymentHistory(): readonly MockPaymentRecord[] {
    return [...this.history]
  }

  /**
   * Returns the current simulated balance as a decimal string.
   *
   * The balance starts at `initialBalance` (default `"1000.00"`) and
   * decreases with each payment. Use this to verify balance deductions
   * or to test insufficient-funds scenarios.
   *
   * @returns The current balance formatted as a decimal string with 2 decimal places
   */
  getBalance(): string {
    return this.balance.toFixed(2)
  }

  /**
   * Returns the total amount spent across all payments in this session.
   *
   * @returns The total spent formatted as a decimal string with 2 decimal places
   */
  getTotalSpent(): string {
    const total = this.history.reduce(
      (sum, record) => sum + Number.parseFloat(record.pricing.amount),
      0
    )
    return total.toFixed(2)
  }

  /**
   * Returns the number of payments made in this session.
   *
   * @returns The payment count
   */
  getPaymentCount(): number {
    return this.history.length
  }

  /**
   * Resets the wallet to its initial state.
   *
   * Clears all payment history and restores the balance to the given amount
   * (or the original initial balance if not specified). Useful for resetting
   * state between test cases.
   *
   * @param balance - New balance to set, as a decimal string. Defaults to "1000.00".
   */
  reset(balance?: string): void {
    this.balance = Number.parseFloat(balance ?? '1000.00')
    this.history.length = 0
  }
}
