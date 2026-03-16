/**
 * @module @openagentpay/adapter-upi
 *
 * UPI payment adapter for OpenAgentPay.
 *
 * This package provides UPI-based payment support for AI agents in India,
 * including transaction verification, UPI AutoPay mandate management,
 * and credit purchases via UPI payment links. Supports Razorpay, Cashfree,
 * and generic payment gateways. No gateway SDK dependency is required —
 * all API calls use native `fetch`.
 *
 * **Server-side:** Use {@link upi} to create a {@link UPIAdapter} that
 * verifies UPI transaction payments.
 *
 * **Mandates:** Use {@link UPIMandateManager} to create and manage UPI
 * AutoPay mandates for recurring charges.
 *
 * **Credit Bridge:** Use {@link UPICreditBridge} to let agents purchase
 * credits via UPI payment links.
 *
 * @example
 * ```typescript
 * // Server — accept UPI payments
 * import { upi } from '@openagentpay/adapter-upi'
 *
 * const adapter = upi({
 *   gateway: 'razorpay',
 *   apiKey: 'rzp_live_...',
 *   apiSecret: 'secret_...',
 *   checkoutUrl: 'https://example.com/upi/checkout',
 * })
 *
 * const paywall = createPaywall({
 *   adapters: [adapter],
 *   recipient: 'provider-id',
 * })
 * ```
 *
 * @example
 * ```typescript
 * // Mandate management — recurring charges
 * import { UPIMandateManager } from '@openagentpay/adapter-upi'
 *
 * const manager = new UPIMandateManager({
 *   gateway: 'razorpay',
 *   apiKey: 'rzp_live_...',
 *   apiSecret: 'secret_...',
 *   maxAmount: 500000,
 *   frequency: 'monthly',
 * })
 *
 * const { mandateId, authUrl } = await manager.createMandate({
 *   payerIdentifier: 'agent-1',
 *   description: 'API usage charges',
 * })
 * ```
 *
 * @example
 * ```typescript
 * // Credit bridge — sell credits via UPI
 * import { UPICreditBridge } from '@openagentpay/adapter-upi'
 * import { InMemoryCreditStore } from '@openagentpay/adapter-credits'
 *
 * const store = new InMemoryCreditStore()
 * const bridge = new UPICreditBridge({
 *   gateway: 'razorpay',
 *   apiKey: 'rzp_live_...',
 *   apiSecret: 'secret_...',
 *   creditStore: store,
 *   callbackUrl: 'https://example.com/upi/callback',
 * })
 *
 * const { paymentUrl } = await bridge.createPaymentLink({
 *   amount: 50000,
 *   payerIdentifier: 'agent-1',
 * })
 * ```
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Class & Interface Exports
// ---------------------------------------------------------------------------

export { UPIAdapter } from './upi-adapter.js'
export { UPIMandateManager } from './upi-mandate.js'
export { UPICreditBridge } from './upi-credit-bridge.js'
export type {
  UPIAdapterConfig,
  UPIMandateConfig,
  UPICreditBridgeConfig,
} from './types.js'

// ---------------------------------------------------------------------------
// Factory Imports
// ---------------------------------------------------------------------------

import { UPIAdapter } from './upi-adapter.js'
import type { UPIAdapterConfig } from './types.js'

// ---------------------------------------------------------------------------
// Factory Function
// ---------------------------------------------------------------------------

/**
 * Creates a server-side UPI payment adapter.
 *
 * The UPI adapter verifies `X-UPI-REFERENCE` payment headers by calling
 * the configured payment gateway API to confirm transaction status and
 * amount.
 *
 * @param config - UPI adapter configuration
 * @param config.gateway - Payment gateway provider ('razorpay', 'cashfree', 'generic')
 * @param config.apiKey - API key for the gateway
 * @param config.apiSecret - API secret for the gateway
 * @param config.checkoutUrl - URL for UPI credit purchases
 * @param config.mandateUrl - URL for UPI mandate setup
 * @param config.sandbox - Whether to use sandbox environment
 * @returns A configured {@link UPIAdapter} instance
 *
 * @example
 * ```typescript
 * import { upi } from '@openagentpay/adapter-upi'
 *
 * const adapter = upi({
 *   gateway: 'razorpay',
 *   apiKey: 'rzp_live_...',
 *   apiSecret: 'secret_...',
 *   checkoutUrl: 'https://example.com/upi/checkout',
 *   mandateUrl: 'https://example.com/upi/mandate',
 * })
 * ```
 */
export function upi(config: UPIAdapterConfig): UPIAdapter {
  return new UPIAdapter(config)
}
