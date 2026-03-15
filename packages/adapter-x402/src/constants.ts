/**
 * @module constants
 *
 * Chain-specific constants for the x402 adapter.
 *
 * Contains USDC contract addresses, chain IDs, and default
 * facilitator configuration for supported networks.
 */

// ---------------------------------------------------------------------------
// USDC Contract Addresses
// ---------------------------------------------------------------------------

/**
 * USDC ERC-20 contract addresses on supported networks.
 *
 * These are the official Circle-deployed USDC contracts:
 * - Base mainnet: native USDC (not bridged)
 * - Base Sepolia: testnet USDC faucet contract
 */
export const USDC_ADDRESSES: Record<string, string> = {
  'base': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
} as const

// ---------------------------------------------------------------------------
// Chain IDs
// ---------------------------------------------------------------------------

/**
 * EVM chain IDs for supported networks.
 */
export const CHAIN_IDS: Record<string, number> = {
  'base': 8453,
  'base-sepolia': 84532,
} as const

// ---------------------------------------------------------------------------
// Facilitator Defaults
// ---------------------------------------------------------------------------

/**
 * Default x402 facilitator URL.
 *
 * The facilitator is the service that verifies EIP-3009 payment
 * authorizations and submits them on-chain for settlement.
 */
export const DEFAULT_FACILITATOR_URL = 'https://x402.org/facilitator'

/**
 * Default timeout in seconds for payment authorizations.
 *
 * The EIP-3009 `validBefore` field is set to `now + timeout`.
 * After this window, the authorization cannot be executed.
 */
export const DEFAULT_TIMEOUT_SECONDS = 300

/**
 * USDC uses 6 decimal places (1 USDC = 1_000_000 smallest units).
 */
export const USDC_DECIMALS = 6

/**
 * HTTP timeout for facilitator requests in milliseconds.
 */
export const FACILITATOR_HTTP_TIMEOUT_MS = 5000

/**
 * Maximum age (in milliseconds) for nonces before they are eligible
 * for cleanup from the in-memory store. Default: 24 hours.
 */
export const NONCE_MAX_AGE_MS = 24 * 60 * 60 * 1000
