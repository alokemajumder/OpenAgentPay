/**
 * @module types
 *
 * Configuration types for the PaymentProxy reverse proxy.
 */

import type { PaymentAdapter } from "@openagentpay/core";

// ---------------------------------------------------------------------------
// Path Pricing
// ---------------------------------------------------------------------------

/**
 * Pricing configuration for a specific path pattern.
 *
 * Patterns support simple glob-style matching:
 * - `"/api/v1/chat"` — exact match
 * - `"/api/v1/*"` — matches one path segment
 * - `"/api/**"` — matches any number of path segments
 */
export interface PathPricing {
  /** Glob-style path pattern. */
  pattern: string;

  /** Amount as a decimal string (e.g. `"0.01"`). */
  amount: string;

  /** Currency code or token symbol (e.g. `"USDC"`). */
  currency: string;

  /** Optional human-readable description. */
  description?: string;
}

// ---------------------------------------------------------------------------
// Proxy Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the PaymentProxy.
 */
export interface ProxyConfig {
  /** Upstream base URL to forward requests to (e.g. `"https://api.example.com"`). */
  upstream: string;

  /**
   * Default pricing applied to all gated paths.
   *
   * Can be overridden per-path via {@link pathPricing}.
   */
  pricing: {
    /** Amount as a decimal string. */
    amount: string;
    /** Currency code or token symbol. */
    currency: string;
  };

  /** Recipient wallet address or account identifier for payments. */
  recipient: string;

  /** Payment adapters to use for verification. */
  adapters?: PaymentAdapter[];

  /**
   * Paths that require payment.
   *
   * If not set, all paths except {@link freePaths} require payment.
   * Supports glob patterns: `"/api/*"`, `"/v1/**"`.
   */
  allowedPaths?: string[];

  /**
   * Paths that bypass payment entirely.
   *
   * Defaults to `["/", "/health", "/healthz", "/ready"]`.
   * Supports glob patterns.
   */
  freePaths?: string[];

  /**
   * Per-path pricing overrides.
   *
   * Evaluated in order; the first matching pattern wins.
   */
  pathPricing?: PathPricing[];

  /**
   * Additional headers to strip from the upstream request
   * (payment-related headers are always stripped).
   */
  stripHeaders?: string[];

  /**
   * Request timeout in milliseconds for upstream calls.
   * Defaults to 30000 (30 seconds).
   */
  timeout?: number;
}
