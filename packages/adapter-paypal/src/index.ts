/**
 * @module @openagentpay/adapter-paypal
 *
 * PayPal payment adapter for OpenAgentPay.
 *
 * This package provides PayPal-based payment support for AI agents,
 * including direct order verification and credit purchases via PayPal
 * Checkout. No PayPal SDK dependency is required — all API calls use
 * native `fetch` with OAuth2 client credentials.
 *
 * **Server-side:** Use {@link paypal} to create a {@link PayPalAdapter} that
 * verifies PayPal order payments.
 *
 * **Credit Bridge:** Use {@link PayPalCreditBridge} to let agents purchase
 * credits via PayPal, with order capture-based fulfillment.
 *
 * @example
 * ```typescript
 * // Server — accept PayPal payments
 * import { paypal } from '@openagentpay/adapter-paypal'
 *
 * const adapter = paypal({
 *   clientId: 'AaBb...',
 *   clientSecret: 'EeFf...',
 *   checkoutUrl: 'https://example.com/paypal/checkout',
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
 * // Credit bridge — sell credits via PayPal
 * import { PayPalCreditBridge } from '@openagentpay/adapter-paypal'
 * import { InMemoryCreditStore } from '@openagentpay/adapter-credits'
 *
 * const store = new InMemoryCreditStore()
 * const bridge = new PayPalCreditBridge({
 *   clientId: 'AaBb...',
 *   clientSecret: 'EeFf...',
 *   creditStore: store,
 *   returnUrl: 'https://example.com/paypal/return',
 *   cancelUrl: 'https://example.com/paypal/cancel',
 * })
 *
 * const { approvalUrl } = await bridge.createOrder({
 *   amount: '10.00',
 *   payerIdentifier: 'agent-1',
 * })
 * ```
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Class & Interface Exports
// ---------------------------------------------------------------------------

export { PayPalAdapter } from './paypal-adapter.js'
export { PayPalCreditBridge } from './paypal-credit-bridge.js'
export type { PayPalAdapterConfig, PayPalCreditBridgeConfig } from './types.js'

// ---------------------------------------------------------------------------
// Factory Imports
// ---------------------------------------------------------------------------

import { PayPalAdapter } from './paypal-adapter.js'
import type { PayPalAdapterConfig } from './types.js'

// ---------------------------------------------------------------------------
// Factory Function
// ---------------------------------------------------------------------------

/**
 * Creates a server-side PayPal payment adapter.
 *
 * The PayPal adapter verifies `X-PAYPAL-ORDER` payment headers by
 * calling the PayPal REST API to confirm order status and amount.
 *
 * @param config - PayPal adapter configuration
 * @param config.clientId - PayPal REST API client ID
 * @param config.clientSecret - PayPal REST API client secret
 * @param config.checkoutUrl - URL for PayPal credit purchases
 * @param config.agreementUrl - URL for PayPal billing agreements
 * @param config.sandbox - Whether to use the sandbox environment
 * @returns A configured {@link PayPalAdapter} instance
 *
 * @example
 * ```typescript
 * import { paypal } from '@openagentpay/adapter-paypal'
 *
 * const adapter = paypal({
 *   clientId: 'AaBb...',
 *   clientSecret: 'EeFf...',
 *   checkoutUrl: 'https://example.com/paypal/checkout',
 *   sandbox: true,
 * })
 * ```
 */
export function paypal(config: PayPalAdapterConfig): PayPalAdapter {
  return new PayPalAdapter(config)
}
