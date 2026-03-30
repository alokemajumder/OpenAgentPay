/**
 * @module types
 *
 * Cloudflare Workers-specific types for the OpenAgentPay paywall middleware.
 * Extends core types with CF-specific bindings (KV, Durable Objects, Analytics Engine).
 */

import type {
  PaymentAdapter,
  Pricing,
  AgentPaymentReceipt,
} from '@openagentpay/core';

// ---------------------------------------------------------------------------
// Cloudflare KV Namespace (minimal interface for type-safety without
// depending on @cloudflare/workers-types at runtime)
// ---------------------------------------------------------------------------

/**
 * Minimal KV Namespace interface matching the Cloudflare Workers runtime.
 * This avoids a hard dependency on `@cloudflare/workers-types`.
 */
export interface KVNamespaceLike {
  get(key: string, options?: { type?: 'text' }): Promise<string | null>;
  get(key: string, options: { type: 'json' }): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number; metadata?: unknown }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    keys: Array<{ name: string; expiration?: number; metadata?: unknown }>;
    list_complete: boolean;
    cursor?: string;
  }>;
}

/**
 * Minimal Durable Object Namespace interface.
 */
export interface DurableObjectNamespaceLike {
  idFromName(name: string): { toString(): string };
  get(id: { toString(): string }): {
    fetch(request: Request): Promise<Response>;
  };
}

/**
 * Minimal Analytics Engine Dataset interface.
 */
export interface AnalyticsEngineLike {
  writeDataPoint(event: {
    blobs?: string[];
    doubles?: number[];
    indexes?: string[];
  }): void;
}

// ---------------------------------------------------------------------------
// Execution Context (minimal interface)
// ---------------------------------------------------------------------------

/**
 * Minimal ExecutionContext interface matching the CF Workers runtime.
 */
export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// ---------------------------------------------------------------------------
// Cloudflare Environment Bindings
// ---------------------------------------------------------------------------

/**
 * Type for the Cloudflare Workers `env` parameter.
 *
 * Users should extend this with their own bindings:
 * ```ts
 * interface MyEnv extends CloudflareEnv {
 *   MY_KV: KVNamespace;
 *   MY_SECRET: string;
 * }
 * ```
 */
export interface CloudflareEnv {
  /** KV namespace for receipt storage. Bound via wrangler.toml. */
  RECEIPT_KV?: KVNamespaceLike;

  /** Durable Object namespace for session management. */
  SESSION_DO?: DurableObjectNamespaceLike;

  /** Analytics Engine dataset for payment analytics. */
  PAYMENT_ANALYTICS?: AnalyticsEngineLike;

  /** Allow additional user-defined bindings. */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Cloudflare Paywall Configuration
// ---------------------------------------------------------------------------

/**
 * Receipt store configuration for Cloudflare Workers.
 */
export interface CloudflareReceiptsConfig {
  /** Whether to emit analytics events for receipts. @default true */
  emit?: boolean;

  /** KV namespace binding name for receipt storage. */
  kvNamespace?: KVNamespaceLike;

  /** TTL in seconds for receipt entries in KV. @default 86400 (24 hours) */
  ttlSeconds?: number;
}

/**
 * Extended paywall configuration with Cloudflare-specific fields.
 */
export interface CloudflarePaywallConfig {
  /** Recipient wallet address — where payments are directed. */
  recipient: string;

  /** Payment adapters, tried in declaration order. */
  adapters: PaymentAdapter[];

  /** KV namespace for receipt storage. */
  kvNamespace?: KVNamespaceLike;

  /** Durable Object namespace for session management. */
  durableObjectNamespace?: DurableObjectNamespaceLike;

  /** Analytics Engine dataset for payment event tracking. */
  analyticsEngine?: AnalyticsEngineLike;

  /** Receipt handling options. */
  receipts?: CloudflareReceiptsConfig;
}

// ---------------------------------------------------------------------------
// Worker Paywall Options (per-route)
// ---------------------------------------------------------------------------

/**
 * Route-level pricing configuration for the worker middleware.
 */
export interface WorkerRouteConfig {
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
 * Dynamic pricing function for Cloudflare Workers.
 * Receives the incoming Request and env bindings.
 */
export type WorkerRouteFn = (
  request: Request,
  env: CloudflareEnv,
) => WorkerRouteConfig | Promise<WorkerRouteConfig>;

/**
 * Options for the worker paywall middleware.
 */
export interface WorkerPaywallOptions {
  /** Route pricing — static config or dynamic function. */
  route: WorkerRouteConfig | WorkerRouteFn;

  /**
   * The upstream handler to call when payment is verified.
   * Receives the original request, env, and execution context.
   */
  handler: (
    request: Request,
    env: CloudflareEnv,
    ctx: ExecutionContextLike,
  ) => Response | Promise<Response>;
}

// ---------------------------------------------------------------------------
// Receipt Store Interface (CF-compatible)
// ---------------------------------------------------------------------------

/**
 * Query filter for listing receipts.
 */
export interface ReceiptQueryFilter {
  /** Filter by payer identifier. */
  payerIdentifier?: string;

  /** Filter by payment method. */
  method?: string;

  /** Filter receipts after this ISO timestamp. */
  after?: string;

  /** Filter receipts before this ISO timestamp. */
  before?: string;

  /** Maximum number of results. */
  limit?: number;

  /** Cursor for pagination (KV cursor). */
  cursor?: string;
}

/**
 * Paginated result from a receipt query.
 */
export interface ReceiptQueryResult {
  /** Matching receipts. */
  receipts: AgentPaymentReceipt[];

  /** Cursor for next page, or undefined if no more results. */
  cursor?: string;
}
