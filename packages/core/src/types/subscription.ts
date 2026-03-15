/**
 * @module subscription
 *
 * Types for the agent subscription system.
 *
 * Agent subscriptions differ fundamentally from human subscriptions:
 * - Duration ranges from hours to months (task-dependent)
 * - Decisions are calculated cost optimizations, not emotional
 * - Cancellation is automatic on task completion or idle
 * - Identity is a wallet address, not an email
 */

// ---------------------------------------------------------------------------
// Subscription Status
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of a subscription.
 */
export type SubscriptionStatus =
  | "active"
  | "expired"
  | "cancelled"
  | "pending_renewal"
  | "suspended";

// ---------------------------------------------------------------------------
// Subscription Period
// ---------------------------------------------------------------------------

/**
 * Billing period for subscriptions and pre-authorizations.
 */
export type SubscriptionPeriod = "hour" | "day" | "week" | "month";

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

/**
 * A subscription record representing an active or historical
 * subscription between an agent and an API provider.
 */
export interface Subscription {
  /** Unique subscription identifier (e.g. `"sub_abc123"`). */
  id: string;

  /** The plan this subscription is based on. */
  plan_id: string;

  /** Opaque token the agent sends via `X-SUBSCRIPTION` header. */
  token: string;

  /** Wallet address or account identifier of the payer. */
  payer_identifier: string;

  /** Wallet address of the recipient / API provider. */
  payee_identifier: string;

  /** Current lifecycle status. */
  status: SubscriptionStatus;

  /** Amount paid for the current period (decimal string). */
  amount: string;

  /** Currency code. */
  currency: string;

  /** Billing period. */
  period: SubscriptionPeriod;

  /**
   * Number of API calls remaining in the current period.
   * `"unlimited"` means no cap.
   */
  calls_remaining: number | "unlimited";

  /**
   * Total calls allowed per period.
   * `"unlimited"` means no cap.
   */
  calls_total: number | "unlimited";

  /** Rate limit in calls per minute. `null` means no limit. */
  rate_limit: number | null;

  /** ISO 8601 timestamp when the subscription was created. */
  created_at: string;

  /** ISO 8601 timestamp when the current period started. */
  period_start: string;

  /** ISO 8601 timestamp when the current period expires. */
  expires_at: string;

  /** Whether automatic renewal is enabled. */
  auto_renew: boolean;

  /** Number of times this subscription has been renewed. */
  renewal_count: number;

  /** Pre-authorization for automatic renewals (if applicable). */
  pre_auth?: SubscriptionPreAuth;
}

// ---------------------------------------------------------------------------
// Subscription Pre-Authorization
// ---------------------------------------------------------------------------

/**
 * Pre-authorization signed by the agent at subscribe time,
 * permitting the server to automatically renew the subscription.
 *
 * For x402 payments, this maps to a recurring EIP-3009
 * transferWithAuthorization.
 */
export interface SubscriptionPreAuth {
  /** Maximum amount per renewal (decimal string). */
  max_amount: string;

  /** Maximum number of auto-renewals. `0` means unlimited. */
  max_renewals: number;

  /** Renewal interval — must match the plan period. */
  period: SubscriptionPeriod;

  /** The agent can revoke this pre-authorization at any time. */
  revocable: true;
}

// ---------------------------------------------------------------------------
// Subscription Store Interface
// ---------------------------------------------------------------------------

/**
 * Storage backend interface for managing subscription lifecycle.
 *
 * Implementations include in-memory (testing), Redis, PostgreSQL,
 * or any custom store. All mutating operations must be atomic.
 */
export interface SubscriptionStore {
  /**
   * Create a new subscription record.
   * @returns The created subscription with all fields populated.
   */
  create(sub: Subscription): Promise<Subscription>;

  /**
   * Look up a subscription by its opaque token.
   * @returns The subscription if found, or `null`.
   */
  getByToken(token: string): Promise<Subscription | null>;

  /**
   * Get all active subscriptions for a given payer.
   * @param payerIdentifier - Wallet address or account ID.
   */
  getByPayer(payerIdentifier: string): Promise<Subscription[]>;

  /**
   * Atomically decrement the call counter for a subscription.
   * @returns The remaining call count after decrement.
   * @throws If the subscription has no calls remaining.
   */
  decrementCalls(
    token: string,
  ): Promise<{ remaining: number | "unlimited" }>;

  /**
   * Check whether the subscription's rate limit has been exceeded.
   * @returns `true` if the request is within rate limits.
   */
  checkRateLimit(token: string): Promise<boolean>;

  /**
   * Cancel a subscription immediately.
   */
  cancel(token: string): Promise<void>;

  /**
   * Renew a subscription: extend expiry and reset the call counter.
   * @returns The updated subscription.
   */
  renew(token: string): Promise<Subscription>;

  /**
   * List subscriptions expiring before the given date.
   * Used by the renewal scheduler to find subscriptions due for renewal.
   */
  listExpiring(before: Date): Promise<Subscription[]>;
}
