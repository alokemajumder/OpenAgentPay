/**
 * @module types
 *
 * Configuration types for the UPI payment adapter, mandate manager,
 * and credit bridge.
 */

// ---------------------------------------------------------------------------
// UPI Adapter Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the server-side {@link UPIAdapter}.
 *
 * The adapter verifies UPI transactions via the configured payment
 * gateway's REST API. Supports multiple gateways (Razorpay, Cashfree,
 * or a generic gateway).
 *
 * @example
 * ```typescript
 * const config: UPIAdapterConfig = {
 *   gateway: 'razorpay',
 *   apiKey: 'rzp_live_...',
 *   apiSecret: 'secret_...',
 *   checkoutUrl: 'https://example.com/upi/checkout',
 * }
 * ```
 */
export interface UPIAdapterConfig {
  /**
   * Payment gateway provider for UPI transactions.
   * Determines which API endpoints and authentication scheme to use.
   */
  gateway: 'razorpay' | 'cashfree' | 'generic'

  /**
   * API key for the payment gateway.
   */
  apiKey: string

  /**
   * API secret for the payment gateway.
   */
  apiSecret: string

  /**
   * URL where agents can purchase credits via UPI payment.
   * Included in the 402 response.
   */
  checkoutUrl?: string

  /**
   * URL where agents can create a UPI AutoPay mandate.
   * Included in the 402 response.
   */
  mandateUrl?: string

  /**
   * Whether to use the sandbox/test environment.
   * @default false
   */
  sandbox?: boolean
}

// ---------------------------------------------------------------------------
// UPI Mandate Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the {@link UPIMandateManager}.
 *
 * UPI AutoPay mandates allow recurring debits from a payer's UPI account
 * without requiring approval for each transaction (up to a configured
 * maximum amount).
 *
 * @example
 * ```typescript
 * const config: UPIMandateConfig = {
 *   gateway: 'razorpay',
 *   apiKey: 'rzp_live_...',
 *   apiSecret: 'secret_...',
 *   maxAmount: 500000,  // Rs 5,000 in paise
 *   frequency: 'monthly',
 * }
 * ```
 */
export interface UPIMandateConfig {
  /**
   * Payment gateway provider.
   */
  gateway: 'razorpay' | 'cashfree' | 'generic'

  /**
   * API key for the payment gateway.
   */
  apiKey: string

  /**
   * API secret for the payment gateway.
   */
  apiSecret: string

  /**
   * Maximum amount per debit in paise (e.g. 500000 = Rs 5,000).
   * This is the upper limit set during mandate creation.
   */
  maxAmount: number

  /**
   * Frequency of recurring debits.
   */
  frequency: 'daily' | 'weekly' | 'monthly'

  /**
   * Whether to use the sandbox/test environment.
   * @default false
   */
  sandbox?: boolean
}

// ---------------------------------------------------------------------------
// UPI Credit Bridge Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the {@link UPICreditBridge}.
 *
 * The credit bridge creates UPI payment links for purchasing credits,
 * and provides a callback handler for fulfilling credit purchases
 * after payment confirmation.
 *
 * @example
 * ```typescript
 * const config: UPICreditBridgeConfig = {
 *   gateway: 'razorpay',
 *   apiKey: 'rzp_live_...',
 *   apiSecret: 'secret_...',
 *   creditStore: myStore,
 *   callbackUrl: 'https://example.com/upi/callback',
 * }
 * ```
 */
export interface UPICreditBridgeConfig {
  /**
   * Payment gateway provider.
   */
  gateway: 'razorpay' | 'cashfree' | 'generic'

  /**
   * API key for the payment gateway.
   */
  apiKey: string

  /**
   * API secret for the payment gateway.
   */
  apiSecret: string

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
   * URL for payment gateway callbacks/webhooks after UPI payment.
   */
  callbackUrl: string

  /**
   * Currency code (ISO 4217).
   * @default 'INR'
   */
  currency?: string

  /**
   * Whether to use the sandbox/test environment.
   * @default false
   */
  sandbox?: boolean
}
