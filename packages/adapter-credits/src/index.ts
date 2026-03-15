/**
 * @module @openagentpay/adapter-credits
 *
 * Prepaid credits payment adapter for OpenAgentPay.
 *
 * This package provides a credit-based payment system where agents purchase
 * credits upfront and spend them per-call without on-chain transactions.
 * It includes both server-side (adapter) and client-side (wallet) components.
 *
 * **Server-side:** Use {@link credits} to create a {@link CreditsAdapter} that
 * verifies credit payment headers and atomically deducts from a credit store.
 *
 * **Client-side:** Use {@link creditsWallet} to create a {@link CreditsWallet}
 * that generates credit payment headers and tracks a local balance.
 *
 * **Store:** Use {@link InMemoryCreditStore} for development/testing, or
 * implement the {@link CreditStore} interface for production persistence.
 *
 * @example
 * ```typescript
 * // Server — accept credit payments
 * import { credits, InMemoryCreditStore } from '@openagentpay/adapter-credits'
 *
 * const store = new InMemoryCreditStore()
 * await store.createAccount('agent-1', '100.00', 'USDC')
 *
 * const paywall = createPaywall({
 *   adapters: [credits({ store })],
 *   recipient: 'provider-wallet',
 * })
 *
 * app.get('/api/data', paywall({ price: '0.01' }), handler)
 * ```
 *
 * @example
 * ```typescript
 * // Client — pay with credits
 * import { creditsWallet } from '@openagentpay/adapter-credits'
 *
 * const wallet = creditsWallet({
 *   accountId: 'agent-1',
 *   initialBalance: '100.00',
 * })
 *
 * const paidFetch = withPayment(fetch, { wallet })
 * const response = await paidFetch('https://api.example.com/data')
 *
 * console.log(wallet.getBalance()) // "99.99"
 * ```
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Class & Interface Exports
// ---------------------------------------------------------------------------

export { CreditsAdapter } from './credits-adapter.js'
export { CreditsWallet } from './credits-wallet.js'
export { InMemoryCreditStore } from './credit-store.js'
export type { CreditStore } from './credit-store.js'
export type { CreditAccount, CreditsAdapterConfig, CreditsWalletConfig } from './types.js'

// ---------------------------------------------------------------------------
// Factory Imports
// ---------------------------------------------------------------------------

import { CreditsAdapter } from './credits-adapter.js'
import type { CreditsAdapterConfig } from './types.js'
import { CreditsWallet } from './credits-wallet.js'
import type { CreditsWalletConfig } from './types.js'

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

/**
 * Creates a server-side credit payment adapter.
 *
 * The credits adapter verifies `X-CREDITS` payment headers against a
 * {@link CreditStore} and atomically deducts the payment amount from
 * the agent's credit balance.
 *
 * Use this as a drop-in adapter for the paywall middleware. Pair it
 * with {@link InMemoryCreditStore} for development or implement
 * {@link CreditStore} with a database for production.
 *
 * @param config - Adapter configuration
 * @param config.store - The credit store for balance management
 * @param config.purchaseUrl - URL where agents can buy credits
 * @param config.balanceUrl - URL where agents can check their balance
 * @returns A configured {@link CreditsAdapter} instance
 *
 * @example
 * ```typescript
 * import { credits, InMemoryCreditStore } from '@openagentpay/adapter-credits'
 *
 * const store = new InMemoryCreditStore()
 * await store.createAccount('agent-1', '100.00', 'USDC')
 *
 * const adapter = credits({
 *   store,
 *   purchaseUrl: 'https://example.com/buy-credits',
 *   balanceUrl: 'https://example.com/balance',
 * })
 * ```
 */
export function credits(config: CreditsAdapterConfig): CreditsAdapter {
  return new CreditsAdapter(config)
}

/**
 * Creates a client-side credit wallet for paying with prepaid credits.
 *
 * The wallet generates `X-CREDITS` authentication headers, tracks a
 * local balance, and supports top-ups. Use it with the client SDK's
 * `withPayment()` wrapper for automatic 402 handling.
 *
 * @param config - Wallet configuration
 * @param config.accountId - The credit account identifier
 * @param config.initialBalance - Starting balance as a decimal string
 * @param config.currency - Currency code (default: `"USDC"`)
 * @returns A configured {@link CreditsWallet} instance
 *
 * @example
 * ```typescript
 * import { creditsWallet } from '@openagentpay/adapter-credits'
 *
 * const wallet = creditsWallet({
 *   accountId: 'agent-1',
 *   initialBalance: '50.00',
 *   currency: 'USDC',
 * })
 *
 * // Pay for API calls
 * const proof = await wallet.pay(method, { amount: '0.01', currency: 'USDC' })
 * console.log(wallet.getBalance()) // "49.99"
 *
 * // Top up when running low
 * wallet.topUp('25.00')
 * console.log(wallet.getBalance()) // "74.99"
 * ```
 */
export function creditsWallet(config: CreditsWalletConfig): CreditsWallet {
  return new CreditsWallet(config)
}
