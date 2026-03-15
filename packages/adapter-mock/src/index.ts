/**
 * @module @openagentpay/adapter-mock
 *
 * Mock payment adapter for OpenAgentPay.
 *
 * This package provides a simulated payment environment for development and
 * testing. It includes both server-side (adapter) and client-side (wallet)
 * components that mirror the behavior of production payment adapters — but
 * without moving real money.
 *
 * **Server-side:** Use {@link mock} to create a {@link MockAdapter} that
 * verifies mock payment proofs and generates realistic receipts.
 *
 * **Client-side:** Use {@link mockWallet} to create a {@link MockWallet}
 * that generates mock payment proofs and tracks a simulated balance.
 *
 * @example
 * ```ts
 * // Server — accept mock payments
 * import { mock } from '@openagentpay/adapter-mock'
 *
 * const paywall = createPaywall({
 *   adapters: [mock()],
 *   recipient: '0xTestRecipient',
 * })
 *
 * app.get('/api/data', paywall({ price: '0.01' }), handler)
 * ```
 *
 * @example
 * ```ts
 * // Client — make mock payments
 * import { mockWallet } from '@openagentpay/adapter-mock'
 *
 * const wallet = mockWallet({ initialBalance: '100.00' })
 *
 * const paidFetch = withPayment(fetch, { wallet })
 * const response = await paidFetch('https://api.example.com/data')
 *
 * // Assert payments in tests
 * expect(wallet.getPaymentCount()).toBe(1)
 * expect(wallet.getBalance()).toBe('99.99')
 * ```
 *
 * @packageDocumentation
 */

export { MockAdapter } from './mock-adapter.js'
export type { MockAdapterOptions } from './mock-adapter.js'

export { MockWallet } from './mock-wallet.js'
export type { MockWalletOptions, MockPaymentRecord } from './mock-wallet.js'

import { MockAdapter } from './mock-adapter.js'
import type { MockAdapterOptions } from './mock-adapter.js'
import { MockWallet } from './mock-wallet.js'
import type { MockWalletOptions } from './mock-wallet.js'

/**
 * Creates a server-side mock payment adapter.
 *
 * The mock adapter simulates payment verification for development and testing.
 * Every payment is automatically accepted, and realistic-looking receipts are
 * generated for each transaction.
 *
 * Use this adapter in place of production adapters (x402, credits) when running
 * locally or in CI/CD pipelines.
 *
 * @param options - Configuration options
 * @param options.logging - Whether to log payment events to the console (default: `true`)
 * @returns A configured {@link MockAdapter} instance
 *
 * @example
 * ```ts
 * import { mock } from '@openagentpay/adapter-mock'
 *
 * // With logging (default)
 * const adapter = mock()
 *
 * // Silent mode for tests
 * const quietAdapter = mock({ logging: false })
 *
 * // Use in paywall middleware
 * const paywall = createPaywall({
 *   adapters: [
 *     process.env.NODE_ENV === 'test' ? mock() : x402({ network: 'base' }),
 *   ],
 * })
 * ```
 */
export function mock(options?: MockAdapterOptions): MockAdapter {
  return new MockAdapter(options)
}

/**
 * Creates a client-side mock wallet for testing.
 *
 * The mock wallet simulates an agent's payment capability. It generates
 * mock payment proofs, tracks a simulated balance, and records every
 * payment made during the session.
 *
 * The wallet starts with a configurable balance (default: `"1000.00"`)
 * and deducts the payment amount with each call to `pay()`. If the
 * balance is insufficient, the payment is rejected with an error —
 * mirroring the behavior of real wallet implementations.
 *
 * @param options - Configuration options
 * @param options.initialBalance - Starting balance as a decimal string (default: `"1000.00"`)
 * @returns A configured {@link MockWallet} instance
 *
 * @example
 * ```ts
 * import { mockWallet } from '@openagentpay/adapter-mock'
 *
 * // Default balance ($1000)
 * const wallet = mockWallet()
 *
 * // Custom balance for testing edge cases
 * const lowFundsWallet = mockWallet({ initialBalance: '0.05' })
 *
 * // Use with the client SDK
 * const paidFetch = withPayment(fetch, {
 *   wallet: mockWallet(),
 *   policy: { maxPerRequest: '1.00' },
 * })
 * ```
 */
export function mockWallet(options?: MockWalletOptions): MockWallet {
  return new MockWallet(options)
}
