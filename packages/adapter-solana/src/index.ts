/**
 * @openagentpay/adapter-solana
 *
 * Solana SPL token payment adapter for OpenAgentPay.
 *
 * Implements Solana-native SPL token payments (USDC and other tokens)
 * using direct on-chain transfers verified via JSON-RPC. Transaction
 * construction uses the native Solana wire format without external
 * dependencies.
 *
 * This package provides:
 *
 * - **SolanaAdapter** — Server-side: detect X-SOLANA-PAYMENT headers, verify via RPC
 * - **SolanaWallet** — Client-side: build, sign, and submit SPL token transfers
 *
 * @example Server-side (API provider)
 * ```ts
 * import { solana } from '@openagentpay/adapter-solana'
 *
 * const adapter = solana({
 *   rpcUrl: 'https://api.mainnet-beta.solana.com',
 *   supportedTokens: ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'],
 * })
 * // Use with createPaywall() from @openagentpay/server
 * ```
 *
 * @example Client-side (AI agent)
 * ```ts
 * import { solanaWallet } from '@openagentpay/adapter-solana'
 *
 * const wallet = solanaWallet({
 *   privateKey: 'base58-encoded-64-byte-keypair...',
 *   rpcUrl: 'https://api.mainnet-beta.solana.com',
 * })
 * const proof = await wallet.pay(method, pricing)
 * ```
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Core classes
// ---------------------------------------------------------------------------

export { SolanaAdapter } from './solana-adapter.js'
export { SolanaWallet } from './solana-wallet.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  SolanaAdapterConfig,
  SolanaWalletConfig,
  SolanaPaymentProof,
  SolanaTokenInfo,
} from './types.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export {
  USDC_MINT,
  DEFAULT_RPC_URLS,
  DEFAULT_RPC_URL,
  TOKEN_DECIMALS,
  KNOWN_TOKENS,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  SOLANA_PAYMENT_HEADER,
} from './constants.js'

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

import { SolanaAdapter } from './solana-adapter.js'
import { SolanaWallet } from './solana-wallet.js'
import type { SolanaAdapterConfig, SolanaWalletConfig } from './types.js'

/**
 * Create a server-side Solana SPL token payment adapter.
 *
 * Factory function for convenience — equivalent to `new SolanaAdapter(config)`.
 *
 * @param config - Adapter configuration
 * @returns A configured SolanaAdapter instance
 *
 * @example
 * ```ts
 * import { solana } from '@openagentpay/adapter-solana'
 *
 * const adapter = solana({
 *   rpcUrl: 'https://api.mainnet-beta.solana.com',
 *   supportedTokens: ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'],
 *   confirmationLevel: 'finalized',
 * })
 * ```
 */
export function solana(config: SolanaAdapterConfig = {}): SolanaAdapter {
  return new SolanaAdapter(config)
}

/**
 * Create a client-side Solana payment wallet.
 *
 * Factory function for convenience — equivalent to `new SolanaWallet(config)`.
 *
 * @param config - Wallet configuration (must include privateKey)
 * @returns A configured SolanaWallet instance
 *
 * @example
 * ```ts
 * import { solanaWallet } from '@openagentpay/adapter-solana'
 *
 * const wallet = solanaWallet({
 *   privateKey: 'base58-encoded-64-byte-keypair...',
 *   rpcUrl: 'https://api.mainnet-beta.solana.com',
 *   tokenMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
 * })
 * ```
 */
export function solanaWallet(config: SolanaWalletConfig): SolanaWallet {
  return new SolanaWallet(config)
}
