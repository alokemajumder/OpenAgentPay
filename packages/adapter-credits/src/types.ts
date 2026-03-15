/**
 * @module types
 *
 * Configuration and data types for the credits payment adapter.
 *
 * These types define the shape of adapter configuration (server-side),
 * wallet configuration (client-side), and the credit account model
 * used by the {@link CreditStore}.
 */

// ---------------------------------------------------------------------------
// Credit Account
// ---------------------------------------------------------------------------

/**
 * Represents a prepaid credit account.
 *
 * Credit accounts hold a fungible balance denominated in a single currency.
 * Agents spend credits per-call without on-chain transactions, making
 * payments instant and gas-free.
 *
 * @example
 * ```typescript
 * const account: CreditAccount = {
 *   id: 'acct_abc123',
 *   balance: '50.00',
 *   currency: 'USDC',
 *   createdAt: '2026-03-15T12:00:00.000Z',
 *   metadata: { agent_id: 'agent-007' },
 * }
 * ```
 */
export interface CreditAccount {
  /** Unique account identifier. */
  id: string

  /** Current balance as a decimal string (e.g. `"50.00"`). */
  balance: string

  /** Currency code or token symbol (e.g. `"USDC"`). */
  currency: string

  /** ISO 8601 timestamp of when the account was created. */
  createdAt: string

  /** Optional key-value metadata for tagging and attribution. */
  metadata?: Record<string, string>
}

// ---------------------------------------------------------------------------
// Server-side Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the server-side {@link CreditsAdapter}.
 *
 * @example
 * ```typescript
 * const config: CreditsAdapterConfig = {
 *   store: new InMemoryCreditStore(),
 *   purchaseUrl: 'https://example.com/buy-credits',
 *   balanceUrl: 'https://example.com/balance',
 * }
 * ```
 */
export interface CreditsAdapterConfig {
  /**
   * The credit store that manages account balances.
   *
   * This is the persistence layer — implementations range from
   * in-memory (for testing) to database-backed (for production).
   */
  store: import('./credit-store.js').CreditStore

  /**
   * URL where agents can purchase additional credits.
   * Included in the 402 response so agents know where to buy.
   * @default 'https://credits.openagentpay.com/purchase'
   */
  purchaseUrl?: string

  /**
   * URL where agents can query their current credit balance.
   * Included in the 402 response for balance visibility.
   * @default 'https://credits.openagentpay.com/balance'
   */
  balanceUrl?: string
}

// ---------------------------------------------------------------------------
// Client-side Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the client-side {@link CreditsWallet}.
 *
 * @example
 * ```typescript
 * const config: CreditsWalletConfig = {
 *   accountId: 'acct_abc123',
 *   initialBalance: '100.00',
 *   currency: 'USDC',
 * }
 * ```
 */
export interface CreditsWalletConfig {
  /** The credit account ID to authenticate with. */
  accountId: string

  /** Starting balance as a decimal string (e.g. `"100.00"`). */
  initialBalance: string

  /**
   * Currency code or token symbol.
   * @default 'USDC'
   */
  currency?: string
}
