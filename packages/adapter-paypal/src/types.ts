/**
 * @module types
 *
 * Configuration types for the PayPal payment adapter and credit bridge.
 */

// ---------------------------------------------------------------------------
// PayPal Adapter Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the server-side {@link PayPalAdapter}.
 *
 * The adapter uses PayPal's REST API directly via `fetch` with OAuth2
 * client credentials authentication. No PayPal SDK dependency is required.
 *
 * @example
 * ```typescript
 * const config: PayPalAdapterConfig = {
 *   clientId: 'AaBb...',
 *   clientSecret: 'EeFf...',
 *   checkoutUrl: 'https://example.com/paypal/checkout',
 *   sandbox: true,
 * }
 * ```
 */
export interface PayPalAdapterConfig {
  /**
   * PayPal REST API client ID.
   * Obtained from the PayPal Developer Dashboard.
   */
  clientId: string

  /**
   * PayPal REST API client secret.
   * Used for server-side OAuth2 authentication.
   */
  clientSecret: string

  /**
   * URL where agents can purchase credits via PayPal.
   * Included in the 402 response.
   */
  checkoutUrl?: string

  /**
   * URL where agents can create a PayPal billing agreement
   * for recurring direct charges.
   * Included in the 402 response.
   */
  agreementUrl?: string

  /**
   * Whether to use the PayPal sandbox environment.
   * @default false
   */
  sandbox?: boolean
}

// ---------------------------------------------------------------------------
// PayPal Credit Bridge Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the {@link PayPalCreditBridge}.
 *
 * The credit bridge creates PayPal orders for purchasing credits,
 * and provides a capture handler for fulfilling credit purchases
 * after the buyer approves the order.
 *
 * @example
 * ```typescript
 * import type { CreditStore } from '@openagentpay/adapter-credits'
 *
 * const config: PayPalCreditBridgeConfig = {
 *   clientId: 'AaBb...',
 *   clientSecret: 'EeFf...',
 *   creditStore: myStore,
 *   returnUrl: 'https://example.com/paypal/return',
 *   cancelUrl: 'https://example.com/paypal/cancel',
 *   sandbox: true,
 * }
 * ```
 */
export interface PayPalCreditBridgeConfig {
  /**
   * PayPal REST API client ID.
   */
  clientId: string

  /**
   * PayPal REST API client secret.
   */
  clientSecret: string

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
   * URL to redirect to after the buyer approves the PayPal order.
   */
  returnUrl: string

  /**
   * URL to redirect to if the buyer cancels the PayPal order.
   */
  cancelUrl: string

  /**
   * Currency code for credit purchases (ISO 4217).
   * @default 'USD'
   */
  currency?: string

  /**
   * Whether to use the PayPal sandbox environment.
   * @default false
   */
  sandbox?: boolean
}
