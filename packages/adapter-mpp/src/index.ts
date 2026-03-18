/**
 * @module @openagentpay/adapter-mpp
 *
 * MPP (Machine Payments Protocol) adapter for OpenAgentPay.
 *
 * This package provides MPP support for AI agent payments using the
 * Challenge-Credential-Receipt pattern. MPP is the open standard for
 * machine payments, supporting multiple payment networks including
 * Tempo, Stripe, and Lightning.
 *
 * **Server-side:** Use {@link mpp} to create an {@link MPPAdapter} that
 * issues challenges, verifies credentials, and manages sessions.
 *
 * **Client-side:** Use {@link mppWallet} to create an {@link MPPWallet}
 * that pays challenges and constructs credentials.
 *
 * @example
 * ```typescript
 * // Server — accept MPP payments
 * import { mpp } from '@openagentpay/adapter-mpp'
 *
 * const adapter = mpp({
 *   networks: ['tempo', 'stripe'],
 *   sessionsSupported: true,
 * })
 *
 * const paywall = createPaywall({
 *   adapters: [adapter],
 *   recipient: '0xabc...',
 * })
 * ```
 *
 * @example
 * ```typescript
 * // Client — pay with MPP via Tempo
 * import { mppWallet } from '@openagentpay/adapter-mpp'
 *
 * const wallet = mppWallet({
 *   network: 'tempo',
 *   tempoPrivateKey: '0xabc...',
 *   tempoRpcUrl: 'https://rpc.tempo.network',
 *   payerIdentifier: '0xdef...',
 * })
 *
 * const client = createClient({ adapters: [wallet] })
 * ```
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Class & Interface Exports
// ---------------------------------------------------------------------------

export { MPPAdapter } from './mpp-adapter.js'
export { MPPWallet } from './mpp-wallet.js'
export { MPPSessionManager } from './mpp-session.js'
export { createChallenge, serializeChallenge, deserializeChallenge, isChallengeExpired } from './challenge.js'
export { createCredential, serializeCredential, deserializeCredential, validateCredentialProof } from './credential.js'
export type {
  MPPAdapterConfig,
  MPPWalletConfig,
  MPPChallenge,
  MPPCredential,
  MPPReceipt,
  MPPSession,
  MPPSessionConfig,
  MPPSessionChargeResult,
  MPPSessionCloseResult,
} from './types.js'

// ---------------------------------------------------------------------------
// Factory Imports
// ---------------------------------------------------------------------------

import { MPPAdapter } from './mpp-adapter.js'
import { MPPWallet } from './mpp-wallet.js'
import type { MPPAdapterConfig, MPPWalletConfig } from './types.js'

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

/**
 * Creates a server-side MPP payment adapter.
 *
 * The MPP adapter issues challenges in 402 responses and verifies
 * credentials containing proof of payment on Tempo, Stripe, or
 * Lightning networks.
 *
 * @param config - MPP adapter configuration
 * @param config.networks - Accepted payment networks (default: ['tempo', 'stripe'])
 * @param config.challengeTtlSeconds - Challenge expiry in seconds (default: 300)
 * @param config.sessionsSupported - Enable MPP sessions (default: false)
 * @param config.tempoRpcUrl - Tempo RPC URL for verifying on-chain payments
 * @param config.stripeSecretKey - Stripe secret key for verifying Stripe payments
 * @returns A configured {@link MPPAdapter} instance
 *
 * @example
 * ```typescript
 * import { mpp } from '@openagentpay/adapter-mpp'
 *
 * const adapter = mpp({
 *   networks: ['tempo', 'stripe', 'lightning'],
 *   sessionsSupported: true,
 *   tempoRpcUrl: 'https://rpc.tempo.network',
 *   stripeSecretKey: 'sk_live_...',
 * })
 * ```
 */
export function mpp(config: MPPAdapterConfig = {}): MPPAdapter {
  return new MPPAdapter(config)
}

/**
 * Creates a client-side MPP wallet for making payments.
 *
 * The wallet executes payments on the configured network and
 * constructs credentials with proof for the Authorization header.
 *
 * @param config - Wallet configuration including network and credentials
 * @param config.network - Payment network: 'tempo', 'stripe', or 'lightning'
 * @param config.tempoPrivateKey - Private key for Tempo payments
 * @param config.stripePaymentMethod - Stripe payment method for Stripe payments
 * @param config.lightningNodeUrl - Lightning node URL for Lightning payments
 * @param config.payerIdentifier - Payer identity (wallet address or account)
 * @returns A configured {@link MPPWallet} instance
 *
 * @example
 * ```typescript
 * import { mppWallet } from '@openagentpay/adapter-mpp'
 *
 * const wallet = mppWallet({
 *   network: 'tempo',
 *   tempoPrivateKey: '0xabc...',
 *   payerIdentifier: '0xdef...',
 * })
 * ```
 */
export function mppWallet(config: MPPWalletConfig): MPPWallet {
  return new MPPWallet(config)
}
