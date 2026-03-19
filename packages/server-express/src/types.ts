import type { Request, Response } from 'express';
import type {
  PaymentAdapter,
  Pricing,
  PaymentMethod,
  SubscriptionPlan,
  AgentPaymentReceipt,
} from '@openagentpay/core';

// ---------------------------------------------------------------------------
// Receipt Store
// ---------------------------------------------------------------------------

/**
 * Interface for persisting payment receipts.
 * Implementations can back this with any storage engine.
 */
export interface ReceiptStore {
  /** Persist a receipt. Implementations must be idempotent on `receipt.id`. */
  save(receipt: AgentPaymentReceipt): Promise<void>;

  /** Retrieve a receipt by its unique ID, or `null` if not found. */
  get(id: string): Promise<AgentPaymentReceipt | null>;

  /** List receipts, most recent first. */
  list(options?: { limit?: number; offset?: number }): Promise<AgentPaymentReceipt[]>;
}

// ---------------------------------------------------------------------------
// Subscription Store
// ---------------------------------------------------------------------------

/** Runtime representation of an active subscription. */
export interface Subscription {
  /** Opaque subscription token (returned to the agent). */
  token: string;
  /** Plan ID that was purchased. */
  planId: string;
  /** Payer identifier (wallet address, agent id, etc.). */
  payerIdentifier: string;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** ISO-8601 expiry timestamp. */
  expiresAt: string;
  /** Remaining calls — `'unlimited'` when the plan has no cap. */
  callsRemaining: number | 'unlimited';
  /** Rate limit from the plan (calls per minute). `null` = no limit. */
  rateLimit: number | null;
  /** Sliding-window timestamps for rate-limit enforcement. */
  rateLimitWindow: number[];
  /** Whether this subscription has been cancelled. */
  cancelled: boolean;
}

/**
 * Interface for storing and managing subscriptions.
 */
export interface SubscriptionStore {
  /** Create a new subscription, returning the persisted record. */
  create(sub: Subscription): Promise<Subscription>;
  /** Lookup by token. Returns `null` when not found or cancelled. */
  getByToken(token: string): Promise<Subscription | null>;
  /** Atomically decrement the call counter. Returns remaining count. */
  decrementCalls(token: string): Promise<{ remaining: number | 'unlimited' }>;
  /** Record a call timestamp and check whether the rate limit is exceeded. Returns `true` if within limits. */
  checkRateLimit(token: string): Promise<boolean>;
  /** Cancel a subscription. */
  cancel(token: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Paywall Configuration
// ---------------------------------------------------------------------------

/** Receipts configuration block. */
export interface ReceiptsConfig {
  /** Whether to emit `payment:received` events. @default true */
  emit?: boolean;
  /** Receipt storage backend. `'memory'` uses a built-in in-memory store. */
  store?: 'memory' | ReceiptStore;
}

/** Subscriptions configuration block. */
export interface SubscriptionsConfig {
  /** Available subscription plans advertised in the 402 response. */
  plans?: SubscriptionPlan[];
  /** Subscription storage backend. `'memory'` uses a built-in in-memory store. */
  store?: 'memory' | SubscriptionStore;
  /** Base path for auto-registered subscription endpoints. @default '/openagentpay' */
  basePath?: string;
}

/** Configuration for intelligent routing (optional). */
export interface PaywallRouterConfig {
  /** Routing strategy. */
  strategy?: string;
  /** Whether to enable automatic cascade/failover. */
  cascade?: boolean;
  /** Maximum cascade attempts. Default: 3 */
  maxCascadeAttempts?: number;
  /** Minimum success rate to consider adapter healthy. Default: 0.5 */
  minSuccessRate?: number;
}

/** Structural type for a SmartRouter instance. Install @openagentpay/router and pass createRouter() result. */
export interface PaywallRouter {
  /** Rank adapters for a given request, returning them in preferred order. */
  rank(request: { amount: string; currency: string; domain?: string; region?: string }): PaymentAdapter[];
  /** Record a successful payment verification for health tracking. */
  recordSuccess(adapterType: string, details: { latencyMs: number }): void;
  /** Record a failed payment verification for health tracking. */
  recordFailure(adapterType: string, details: { error?: string }): void;
}

/** Top-level configuration for `createPaywall`. */
export interface PaywallConfig {
  /** Recipient wallet address — where payments are directed. */
  recipient: string;
  /** Payment adapters, tried in declaration order. */
  adapters: PaymentAdapter[];
  /** Receipt handling options. */
  receipts?: ReceiptsConfig;
  /** Subscription handling options. */
  subscriptions?: SubscriptionsConfig;
  /** Intelligent routing configuration. When set, adapters are routed using the smart router instead of static iteration. */
  routing?: PaywallRouterConfig;
  /**
   * Pre-built SmartRouter instance for intelligent adapter selection.
   * When provided, the middleware uses the router's `rank()` method to determine
   * adapter order (based on cost, health, latency, and strategy) instead of
   * static iteration over `adapters`. Health tracking is automatically fed
   * back via `recordSuccess` / `recordFailure`.
   *
   * When not provided, adapters are tried in declaration order (backward compatible).
   *
   * @example
   * ```typescript
   * import { SmartRouter } from '@openagentpay/router';
   *
   * const router = new SmartRouter({
   *   adapters: [
   *     { adapter: mppAdapter, priority: 1 },
   *     { adapter: stripeAdapter, priority: 3, costPerTransaction: '0.30' },
   *   ],
   *   strategy: 'smart',
   * });
   *
   * const paywall = createPaywall({ recipient: '0x...', adapters: [mppAdapter, stripeAdapter], router });
   * ```
   */
  router?: PaywallRouter;
}

// ---------------------------------------------------------------------------
// Route-level configuration
// ---------------------------------------------------------------------------

/** Static route pricing. */
export interface PaywallRouteConfig {
  /** Price as a decimal string (e.g. `"0.01"`). */
  price: string;
  /** Currency code — ISO 4217 or token symbol. @default `"USDC"` */
  currency?: string;
  /** Pricing unit. @default `"per_request"` */
  unit?: 'per_request' | 'per_kb' | 'per_second' | 'per_unit';
  /** Human-readable description included in the 402 body. */
  description?: string;
}

/**
 * A dynamic pricing function receives the Express request and returns
 * route pricing (or a promise thereof).
 */
export type PaywallRouteFn = (req: Request) => PaywallRouteConfig | Promise<PaywallRouteConfig>;

/**
 * The argument accepted by the `paywall()` middleware factory.
 * Can be a static config object or a dynamic pricing function.
 */
export type PaywallRouteArg = PaywallRouteConfig | PaywallRouteFn;

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** Event map for the paywall event emitter. */
export interface PaywallEvents {
  'payment:received': AgentPaymentReceipt;
  'payment:failed': {
    code: string;
    message: string;
    request: {
      method: string;
      url: string;
      ip?: string;
    };
  };
}
