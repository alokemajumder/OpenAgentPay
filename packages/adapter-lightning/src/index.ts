/**
 * @openagentpay/adapter-lightning
 *
 * Lightning Network BOLT11 payment adapter for OpenAgentPay.
 *
 * Implements Lightning-native micropayments using BOLT11 invoices
 * via the LND REST API. Preimage-based proof-of-payment enables
 * trustless verification without on-chain settlement delays.
 *
 * This package provides:
 *
 * - **LightningAdapter** — Server-side: create invoices, detect X-LIGHTNING-PAYMENT headers, verify via LND
 * - **LightningWallet** — Client-side: pay BOLT11 invoices, extract preimage proofs
 *
 * @example Server-side (API provider)
 * ```ts
 * import { lightning } from '@openagentpay/adapter-lightning'
 *
 * const adapter = lightning({
 *   nodeUrl: 'https://localhost:8080',
 *   macaroon: 'hex-encoded-macaroon...',
 * })
 * // Use with createPaywall() from @openagentpay/server
 * ```
 *
 * @example Client-side (AI agent)
 * ```ts
 * import { lightningWallet } from '@openagentpay/adapter-lightning'
 *
 * const wallet = lightningWallet({
 *   nodeUrl: 'https://localhost:8080',
 *   macaroon: 'hex-encoded-macaroon...',
 *   maxFeeSats: 10,
 * })
 * const proof = await wallet.pay(method, pricing)
 * ```
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Core classes
// ---------------------------------------------------------------------------

export { LightningAdapter } from './lightning-adapter.js'
export { LightningWallet } from './lightning-wallet.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  LightningAdapterConfig,
  LightningWalletConfig,
  LightningInvoice,
  LightningPaymentProof,
} from './types.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export {
  DEFAULT_INVOICE_EXPIRY,
  SATS_PER_BTC,
  LIGHTNING_PAYMENT_HEADER,
  LND_ADD_INVOICE_PATH,
  LND_LOOKUP_INVOICE_PATH,
  LND_SEND_PAYMENT_PATH,
  LND_HTTP_TIMEOUT_MS,
} from './constants.js'

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

import { LightningAdapter } from './lightning-adapter.js'
import { LightningWallet } from './lightning-wallet.js'
import type { LightningAdapterConfig, LightningWalletConfig } from './types.js'

/**
 * Create a server-side Lightning Network payment adapter.
 *
 * Factory function for convenience — equivalent to `new LightningAdapter(config)`.
 *
 * @param config - Adapter configuration (LND node URL and macaroon)
 * @returns A configured LightningAdapter instance
 *
 * @example
 * ```ts
 * import { lightning } from '@openagentpay/adapter-lightning'
 *
 * const adapter = lightning({
 *   nodeUrl: 'https://localhost:8080',
 *   macaroon: 'hex-encoded-macaroon...',
 *   invoiceExpirySeconds: 300,
 * })
 * ```
 */
export function lightning(config: LightningAdapterConfig): LightningAdapter {
  return new LightningAdapter(config)
}

/**
 * Create a client-side Lightning payment wallet.
 *
 * Factory function for convenience — equivalent to `new LightningWallet(config)`.
 *
 * @param config - Wallet configuration (LND node URL and macaroon)
 * @returns A configured LightningWallet instance
 *
 * @example
 * ```ts
 * import { lightningWallet } from '@openagentpay/adapter-lightning'
 *
 * const wallet = lightningWallet({
 *   nodeUrl: 'https://localhost:8080',
 *   macaroon: 'hex-encoded-macaroon...',
 *   maxFeeSats: 10,
 * })
 * ```
 */
export function lightningWallet(config: LightningWalletConfig): LightningWallet {
  return new LightningWallet(config)
}
