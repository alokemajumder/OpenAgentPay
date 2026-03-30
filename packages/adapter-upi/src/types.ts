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

// ---------------------------------------------------------------------------
// Webhook Verifier Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the {@link UPIWebhookVerifier}.
 *
 * @example
 * ```typescript
 * const config: WebhookVerifierConfig = {
 *   gateway: 'razorpay',
 *   webhookSecret: 'whsec_...',
 * }
 * ```
 */
export interface WebhookVerifierConfig {
  /**
   * Payment gateway provider whose webhook signatures to verify.
   */
  gateway: 'razorpay' | 'cashfree' | 'generic'

  /**
   * Webhook secret used for HMAC signature verification.
   */
  webhookSecret: string
}

/**
 * Parsed and verified webhook event.
 */
export interface WebhookEvent {
  /** Unique event identifier. */
  id: string

  /** Event type (e.g. 'payment.captured', 'refund.processed'). */
  event: string

  /** Event payload from the gateway. */
  payload: Record<string, unknown>

  /** Whether the signature was verified successfully. */
  verified: boolean

  /** ISO 8601 timestamp of the event. */
  timestamp: string
}

// ---------------------------------------------------------------------------
// UPI QR Code Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the {@link UPIQRCodeManager}.
 *
 * @example
 * ```typescript
 * const config: UPIQRConfig = {
 *   gateway: 'razorpay',
 *   apiKey: 'rzp_live_...',
 *   apiSecret: 'secret_...',
 * }
 * ```
 */
export interface UPIQRConfig {
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
   * Whether to use the sandbox/test environment.
   * @default false
   */
  sandbox?: boolean
}

/**
 * Result of creating or querying a UPI QR code.
 */
export interface QRCodeResult {
  /** QR code identifier from the gateway. */
  qrId: string

  /** URL to the QR code image. */
  qrCodeUrl: string

  /** Raw QR data string for custom rendering. */
  qrData?: string

  /** Amount in paise. */
  amount: number

  /** ISO 8601 expiry timestamp. */
  expiresAt?: string

  /** Current status of the QR code (e.g. 'active', 'closed', 'paid'). */
  status: string
}

// ---------------------------------------------------------------------------
// UPI Refund Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the {@link UPIRefundManager}.
 *
 * @example
 * ```typescript
 * const config: UPIRefundConfig = {
 *   gateway: 'razorpay',
 *   apiKey: 'rzp_live_...',
 *   apiSecret: 'secret_...',
 * }
 * ```
 */
export interface UPIRefundConfig {
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
   * Whether to use the sandbox/test environment.
   * @default false
   */
  sandbox?: boolean
}

/**
 * Result of creating or querying a refund.
 */
export interface RefundResult {
  /** Refund identifier from the gateway. */
  refundId: string

  /** Original payment identifier. */
  paymentId: string

  /** Refund amount in paise. */
  amount: number

  /** Current refund status (e.g. 'processed', 'pending', 'failed'). */
  status: string

  /** ISO 8601 timestamp when the refund was created. */
  createdAt: string
}

// ---------------------------------------------------------------------------
// UPI Reserve Pay (SBMD) Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the {@link UPIReservePayManager}.
 *
 * UPI Reserve Pay (Single Block Multi Debit) lets a payer set a spending
 * limit once (up to Rs 10,000 for 90 days). Agents can then make multiple
 * debits without UPI PIN/OTP per transaction. Funds are blocked upfront
 * in the payer's bank account.
 *
 * @example
 * ```typescript
 * const config: UPIReservePayConfig = {
 *   gateway: 'razorpay',
 *   apiKey: 'rzp_live_...',
 *   apiSecret: 'secret_...',
 * }
 * ```
 */
export interface UPIReservePayConfig {
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
   * Whether to use the sandbox/test environment.
   * @default false
   */
  sandbox?: boolean
}

/**
 * Represents a UPI Reserve Pay (SBMD) block.
 *
 * A block is a budget envelope: funds are blocked upfront in the payer's
 * account and the agent can make multiple debits against it without
 * requiring UPI PIN/OTP for each transaction.
 */
export interface ReservePayBlock {
  /** Unique block identifier. */
  blockId: string

  /** Payer's UPI VPA (e.g. "user@upi"). */
  payerVPA: string

  /** Agent or account identifier that owns this block. */
  payerIdentifier: string

  /** Total amount blocked in paise (max 1,000,000 = Rs 10,000). */
  totalAmount: number

  /** Amount already debited in paise. */
  spentAmount: number

  /** Remaining available amount in paise. */
  remainingAmount: number

  /** Currency code (ISO 4217). */
  currency: string

  /** Current block status. */
  status: 'created' | 'authorized' | 'active' | 'exhausted' | 'expired' | 'cancelled'

  /** ISO 8601 expiry timestamp. */
  expiresAt: string

  /** ISO 8601 creation timestamp. */
  createdAt: string

  /** Number of debits executed against this block. */
  transactionCount: number

  /** ISO 8601 timestamp of the last debit, if any. */
  lastDebitAt?: string
}

/**
 * Result of executing a debit against a Reserve Pay block.
 */
export interface ReservePayDebitResult {
  /** Unique transaction identifier for this debit. */
  transactionId: string

  /** Amount debited in paise. */
  amount: number

  /** Remaining available amount in paise after this debit. */
  remainingAmount: number

  /** Transaction status. */
  status: string

  /** ISO 8601 timestamp of the debit. */
  timestamp: string
}
