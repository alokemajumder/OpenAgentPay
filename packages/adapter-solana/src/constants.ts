/**
 * @module constants
 *
 * Solana-specific constants for the adapter.
 *
 * Contains USDC mint addresses, default RPC URLs, and token
 * metadata for supported networks.
 */

import type { SolanaTokenInfo } from './types.js'

// ---------------------------------------------------------------------------
// USDC Mint Addresses
// ---------------------------------------------------------------------------

/**
 * USDC SPL token mint addresses on Solana networks.
 *
 * These are the official Circle-deployed USDC mints:
 * - mainnet-beta: native USDC on Solana
 * - devnet: test USDC for development
 */
export const USDC_MINT: Record<string, string> = {
  'mainnet-beta': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'devnet': '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
} as const

// ---------------------------------------------------------------------------
// Default RPC URLs
// ---------------------------------------------------------------------------

/**
 * Default Solana JSON-RPC URLs.
 *
 * These are Solana Foundation public endpoints — suitable for
 * development and testing. Production deployments should use
 * dedicated RPC providers (Helius, QuickNode, Triton, etc.).
 */
export const DEFAULT_RPC_URLS: Record<string, string> = {
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
  'devnet': 'https://api.devnet.solana.com',
} as const

/**
 * Default RPC URL used when none is specified.
 */
export const DEFAULT_RPC_URL = DEFAULT_RPC_URLS['mainnet-beta']

// ---------------------------------------------------------------------------
// Token Decimals
// ---------------------------------------------------------------------------

/**
 * Decimal places for known SPL tokens, keyed by mint address.
 *
 * USDC and USDT both use 6 decimals on Solana.
 */
export const TOKEN_DECIMALS: Record<string, number> = {
  // USDC mainnet
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 6,
  // USDC devnet
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU': 6,
  // USDT mainnet
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 6,
} as const

// ---------------------------------------------------------------------------
// Token Info
// ---------------------------------------------------------------------------

/**
 * Well-known SPL token metadata, keyed by mint address.
 */
export const KNOWN_TOKENS: Record<string, SolanaTokenInfo> = {
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': {
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    decimals: 6,
    symbol: 'USDC',
  },
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU': {
    mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    decimals: 6,
    symbol: 'USDC',
  },
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': {
    mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    decimals: 6,
    symbol: 'USDT',
  },
} as const

// ---------------------------------------------------------------------------
// Solana Program IDs
// ---------------------------------------------------------------------------

/**
 * SPL Token Program ID on Solana.
 */
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'

/**
 * SPL Associated Token Account Program ID.
 */
export const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'

/**
 * Solana System Program ID.
 */
export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111'

/**
 * HTTP timeout for RPC requests in milliseconds.
 */
export const RPC_HTTP_TIMEOUT_MS = 10_000

/**
 * Header name for Solana payment proofs.
 */
export const SOLANA_PAYMENT_HEADER = 'x-solana-payment'
