/**
 * @module @openagentpay/adapter-stripe
 *
 * Stripe payment adapter for OpenAgentPay.
 *
 * This package provides Stripe-based payment support for AI agents,
 * including direct per-call charges and credit purchases via Stripe
 * Checkout. No Stripe SDK dependency is required — all API calls use
 * native `fetch`.
 *
 * **Server-side:** Use {@link stripe} to create a {@link StripeAdapter} that
 * verifies Stripe PaymentIntent and Checkout Session payments.
 *
 * **Credit Bridge:** Use {@link StripeCreditBridge} to let agents purchase
 * credits via Stripe Checkout, with webhook-based fulfillment.
 *
 * @example
 * ```typescript
 * // Server — accept Stripe payments
 * import { stripe } from '@openagentpay/adapter-stripe'
 *
 * const adapter = stripe({
 *   secretKey: 'sk_live_...',
 *   checkoutUrl: 'https://example.com/checkout',
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
 * // Credit bridge — sell credits via Stripe
 * import { StripeCreditBridge } from '@openagentpay/adapter-stripe'
 * import { InMemoryCreditStore } from '@openagentpay/adapter-credits'
 *
 * const store = new InMemoryCreditStore()
 * const bridge = new StripeCreditBridge({
 *   stripeSecretKey: 'sk_live_...',
 *   creditStore: store,
 *   successUrl: 'https://example.com/success',
 *   cancelUrl: 'https://example.com/cancel',
 * })
 *
 * const { url } = await bridge.createCheckoutSession({
 *   amount: 1000,
 *   payerIdentifier: 'agent-1',
 * })
 * ```
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Class & Interface Exports
// ---------------------------------------------------------------------------

export { StripeAdapter } from './stripe-adapter.js'
export { StripeCreditBridge } from './stripe-credit-bridge.js'
export type { StripeAdapterConfig, StripeCreditBridgeConfig } from './types.js'

// ---------------------------------------------------------------------------
// Factory Imports
// ---------------------------------------------------------------------------

import { StripeAdapter } from './stripe-adapter.js'
import type { StripeAdapterConfig } from './types.js'

// ---------------------------------------------------------------------------
// Factory Function
// ---------------------------------------------------------------------------

/**
 * Creates a server-side Stripe payment adapter.
 *
 * The Stripe adapter verifies `X-STRIPE-SESSION` payment headers by
 * calling the Stripe REST API to confirm payment status and amount.
 *
 * @param config - Stripe adapter configuration
 * @param config.secretKey - Stripe secret key for API authentication
 * @param config.publishableKey - Stripe publishable key for client-side
 * @param config.checkoutUrl - URL for Stripe Checkout credit purchases
 * @param config.setupUrl - URL for setting up direct payment methods
 * @param config.directCharge - Whether direct per-call charges are supported
 * @returns A configured {@link StripeAdapter} instance
 *
 * @example
 * ```typescript
 * import { stripe } from '@openagentpay/adapter-stripe'
 *
 * const adapter = stripe({
 *   secretKey: 'sk_live_...',
 *   publishableKey: 'pk_live_...',
 *   checkoutUrl: 'https://example.com/checkout',
 *   directCharge: true,
 * })
 * ```
 */
export function stripe(config: StripeAdapterConfig): StripeAdapter {
  return new StripeAdapter(config)
}
