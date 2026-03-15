/**
 * @openagentpay/adapter-x402
 *
 * x402 stablecoin payment adapter for OpenAgentPay.
 *
 * Implements the x402 protocol for real USDC payments on Base (Coinbase's L2)
 * using EIP-3009 transferWithAuthorization for gasless, facilitator-settled
 * stablecoin transfers.
 *
 * This package provides:
 *
 * - **X402Adapter** — Server-side: detect X-PAYMENT headers, verify via facilitator
 * - **X402Wallet** — Client-side: sign EIP-3009 authorizations, produce payment proofs
 * - **InMemoryNonceStore** — Replay protection for single-process deployments
 *
 * @example Server-side (API provider)
 * ```ts
 * import { x402 } from '@openagentpay/adapter-x402'
 *
 * const adapter = x402({ network: 'base-sepolia' })
 * // Use with createPaywall() from @openagentpay/server
 * ```
 *
 * @example Client-side (AI agent)
 * ```ts
 * import { x402Wallet } from '@openagentpay/adapter-x402'
 *
 * const wallet = x402Wallet({
 *   privateKey: '0xac0974bec...',
 *   network: 'base-sepolia',
 * })
 * const proof = await wallet.pay(method, pricing)
 * ```
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Core classes
// ---------------------------------------------------------------------------

export { X402Adapter } from './x402-adapter.js'
export { X402Wallet } from './x402-wallet.js'
export { InMemoryNonceStore } from './nonce-store.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  X402AdapterConfig,
  X402WalletConfig,
  X402Payment,
  EIP3009Authorization,
  FacilitatorResponse,
  NonceStore,
  EIP712Domain,
  EIP712TypedData,
} from './types.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export {
  USDC_ADDRESSES,
  CHAIN_IDS,
  DEFAULT_FACILITATOR_URL,
  DEFAULT_TIMEOUT_SECONDS,
  USDC_DECIMALS,
} from './constants.js'

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export {
  buildAuthorization,
  buildTypedData,
  buildEIP712Domain,
  signAuthorization,
  encodePayment,
  decodePayment,
  deriveAddress,
  generateNonce,
  toUSDCSmallestUnit,
} from './eip3009.js'

export { verifyWithFacilitator } from './facilitator.js'

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

import { X402Adapter } from './x402-adapter.js'
import { X402Wallet } from './x402-wallet.js'
import type { X402AdapterConfig, X402WalletConfig } from './types.js'

/**
 * Create a server-side x402 payment adapter.
 *
 * Factory function for convenience — equivalent to `new X402Adapter(config)`.
 *
 * @param config - Adapter configuration
 * @returns A configured X402Adapter instance
 *
 * @example
 * ```ts
 * import { x402 } from '@openagentpay/adapter-x402'
 *
 * const adapter = x402({
 *   network: 'base-sepolia',
 *   facilitatorUrl: 'https://x402.org/facilitator',
 *   timeoutSeconds: 300,
 * })
 * ```
 */
export function x402(config: X402AdapterConfig = {}): X402Adapter {
  return new X402Adapter(config)
}

/**
 * Create a client-side x402 payment wallet.
 *
 * Factory function for convenience — equivalent to `new X402Wallet(config)`.
 *
 * @param config - Wallet configuration (must include privateKey)
 * @returns A configured X402Wallet instance
 *
 * @example
 * ```ts
 * import { x402Wallet } from '@openagentpay/adapter-x402'
 *
 * const wallet = x402Wallet({
 *   privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
 *   network: 'base-sepolia',
 * })
 * ```
 */
export function x402Wallet(config: X402WalletConfig): X402Wallet {
  return new X402Wallet(config)
}
