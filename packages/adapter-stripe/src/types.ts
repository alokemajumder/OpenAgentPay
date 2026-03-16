/**
 * @module types
 *
 * Configuration types for the Stripe payment adapter and credit bridge.
 */

// ---------------------------------------------------------------------------
// Stripe Adapter Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the server-side {@link StripeAdapter}.
 *
 * The adapter uses Stripe's REST API directly via `fetch` — no Stripe SDK
 * dependency is required.
 *
 * @example
 * ```typescript
 * const config: StripeAdapterConfig = {
 *   secretKey: 'sk_live_...',
 *   checkoutUrl: 'https://example.com/stripe/checkout',
 *   setupUrl: 'https://example.com/stripe/setup',
 * }
 * ```
 */
export interface StripeAdapterConfig {
  /**
   * Stripe secret key for server-side API calls.
   * Starts with `sk_live_` or `sk_test_`.
   */
  secretKey: string

  /**
   * Stripe publishable key for client-side use.
   * Starts with `pk_live_` or `pk_test_`.
   */
  publishableKey?: string

  /**
   * URL where agents can purchase credits via Stripe Checkout.
   * Included in the 402 response.
   */
  checkoutUrl?: string

  /**
   * URL where agents can set up a payment method for direct charges.
   * Included in the 402 response.
   */
  setupUrl?: string

  /**
   * Whether direct per-call charging is supported.
   * Direct charges require a minimum of $0.50 (50 cents).
   * @default false
   */
  directCharge?: boolean

  /**
   * Stripe webhook signing secret for verifying webhook payloads.
   * Required if using the {@link StripeCreditBridge} webhook handler.
   */
  webhookSecret?: string
}

// ---------------------------------------------------------------------------
// Stripe Credit Bridge Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the {@link StripeCreditBridge}.
 *
 * The credit bridge creates Stripe Checkout Sessions for purchasing
 * credits, and provides a webhook handler for fulfilling credit
 * purchases when the payment completes.
 *
 * @example
 * ```typescript
 * import type { CreditStore } from '@openagentpay/adapter-credits'
 *
 * const config: StripeCreditBridgeConfig = {
 *   stripeSecretKey: 'sk_live_...',
 *   creditStore: myStore,
 *   successUrl: 'https://example.com/success',
 *   cancelUrl: 'https://example.com/cancel',
 *   currency: 'usd',
 *   creditAmounts: [5_00, 10_00, 25_00, 50_00, 100_00],
 * }
 * ```
 */
export interface StripeCreditBridgeConfig {
  /**
   * Stripe secret key for creating Checkout Sessions.
   */
  stripeSecretKey: string

  /**
   * The credit store where purchased credits will be deposited.
   * Implements the CreditStore interface from `@openagentpay/adapter-credits`.
   */
  creditStore: {
    getAccount(id: string): Promise<{ id: string; balance: string; currency: string } | null>
    topUp(id: string, amount: string): Promise<{ id: string; balance: string; currency: string }>
    createAccount(id: string, initialBalance: string, currency: string): Promise<{ id: string; balance: string; currency: string }>
  }

  /**
   * URL to redirect to after a successful Checkout Session.
   * Stripe will append `?session_id={CHECKOUT_SESSION_ID}` to this URL.
   */
  successUrl: string

  /**
   * URL to redirect to if the customer cancels the Checkout Session.
   */
  cancelUrl: string

  /**
   * Currency code for credit purchases.
   * @default 'usd'
   */
  currency?: string

  /**
   * Preset credit amounts in the smallest currency unit (e.g. cents for USD).
   * Used to validate and suggest purchase amounts.
   * @default [500, 1000, 2500, 5000, 10000]
   */
  creditAmounts?: number[]

  /**
   * Stripe webhook signing secret for verifying webhook payloads.
   * Required for the {@link StripeCreditBridge.handleWebhook} method.
   */
  webhookSecret?: string
}
