/**
 * @module types
 *
 * Configuration types for the OpenAgentPay client SDK.
 *
 * These types define the agent-side configuration surface:
 * wallet adapters, spend policies, subscription preferences,
 * and event callbacks.
 *
 * @packageDocumentation
 */

import type {
  PaymentMethod,
  Pricing,
  PaymentProof,
  AgentPaymentReceipt,
} from "@openagentpay/core";

// ---------------------------------------------------------------------------
// Wallet Adapter (Client-Side)
// ---------------------------------------------------------------------------

/**
 * Agent-side wallet adapter interface.
 *
 * A wallet adapter knows how to execute payments for one or more
 * payment methods. The client SDK calls `supports()` to match
 * available adapters to the methods advertised in a 402 response,
 * then calls `pay()` to execute the selected method.
 *
 * @example
 * ```typescript
 * const wallet: WalletAdapter = {
 *   pay: async (method, pricing) => ({
 *     header: 'X-PAYMENT',
 *     value: 'mock:proof-abc123',
 *   }),
 *   supports: (method) => method.type === 'mock',
 * };
 * ```
 */
export interface WalletAdapter {
  /**
   * Execute a payment and return the proof to attach to the retry request.
   *
   * Called after policy approval. The returned `PaymentProof` contains
   * the HTTP header name and value to send on the subsequent request.
   *
   * @param method - The payment method selected from the 402 response.
   * @param pricing - The resolved pricing for this request.
   * @returns A payment proof to attach as an HTTP header.
   */
  pay(method: PaymentMethod, pricing: Pricing): Promise<PaymentProof>;

  /**
   * Check whether this wallet can handle the given payment method.
   *
   * Called by the client to match the wallet's capabilities against
   * the payment methods advertised in the 402 response.
   *
   * @param method - A payment method from the 402 response.
   * @returns `true` if this wallet can pay using this method.
   */
  supports(method: PaymentMethod): boolean;
}

// ---------------------------------------------------------------------------
// Policy Configuration
// ---------------------------------------------------------------------------

/**
 * Spend governance policy for autonomous agent payments.
 *
 * These limits prevent runaway costs by constraining what an agent
 * can spend per request, per day, per session, and per provider.
 * Domain allow/block lists provide coarse-grained access control.
 *
 * All monetary amounts are decimal strings (e.g. `"10.00"`) to
 * avoid floating-point precision issues.
 */
export interface SpendPolicy {
  /**
   * Maximum amount allowed for a single request.
   * Requests exceeding this are denied without calling the wallet.
   */
  maxPerRequest?: string;

  /**
   * Maximum total spend in a rolling 24-hour window.
   * Prevents runaway costs from high-frequency calls.
   */
  maxPerDay?: string;

  /**
   * Maximum total spend since the client was initialized.
   * A hard ceiling for the entire agent session.
   */
  maxPerSession?: string;

  /**
   * Maximum total spend per provider domain in a rolling 24-hour window.
   * Prevents a single provider from consuming the entire budget.
   */
  maxPerProvider?: string;

  /**
   * Glob patterns of allowed domains (e.g. `["*.example.com", "api.trusted.io"]`).
   * If set, only matching domains are allowed. Supports simple `*` wildcard matching.
   */
  allowedDomains?: string[];

  /**
   * Glob patterns of blocked domains (e.g. `["*.untrusted.io"]`).
   * Evaluated after `allowedDomains`. Supports simple `*` wildcard matching.
   */
  blockedDomains?: string[];

  /**
   * Currency codes the agent is willing to pay in (e.g. `["USDC"]`).
   * Requests requiring other currencies are denied.
   */
  allowedCurrencies?: string[];

  /**
   * Amount threshold above which `onPolicyDenied` is called and the
   * payment is rejected. Useful for flagging unusually expensive requests.
   */
  approvalThreshold?: string;

  /**
   * When `true`, the client logs policy decisions but does not actually
   * execute payments. Useful for dry-run testing.
   */
  testMode?: boolean;
}

// ---------------------------------------------------------------------------
// Subscription Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for automatic subscription optimization.
 *
 * When enabled, the client can evaluate subscription plans offered
 * in 402 responses and subscribe when it would save money compared
 * to per-request pricing.
 */
export interface SubscriptionConfig {
  /**
   * Automatically subscribe to plans when projected savings exceed
   * the `savingsThreshold`. Default: `false`.
   */
  autoOptimize?: boolean;

  /**
   * Maximum subscription cost the agent is willing to commit to.
   * Plans exceeding this amount are ignored.
   */
  maxCommitment?: string;

  /**
   * Preferred billing period for subscriptions.
   * When multiple plans match, the one closest to this period is preferred.
   */
  preferredPeriod?: "hour" | "day" | "week" | "month";

  /**
   * Auto-cancel subscriptions after this idle duration.
   * Format: duration string (e.g. `"1h"`, `"30m"`).
   */
  autoCancelOnIdle?: string;

  /**
   * Minimum projected savings ratio to trigger auto-subscription.
   * E.g. `0.20` means the subscription must save at least 20%
   * compared to per-request pricing. Default: `0.20`.
   */
  savingsThreshold?: number;
}

// ---------------------------------------------------------------------------
// Client Configuration
// ---------------------------------------------------------------------------

/**
 * Complete configuration for the OpenAgentPay client.
 *
 * Pass this to `withPayment()` to create a payment-aware fetch wrapper
 * that transparently handles 402 Payment Required responses.
 *
 * @example
 * ```typescript
 * const config: ClientConfig = {
 *   wallet: myWalletAdapter,
 *   policy: {
 *     maxPerRequest: '1.00',
 *     maxPerDay: '50.00',
 *     allowedDomains: ['*.example.com'],
 *   },
 *   onReceipt: (receipt) => console.log('Paid:', receipt.payment.amount),
 * };
 *
 * const paidFetch = withPayment(fetch, config);
 * const response = await paidFetch('https://api.example.com/search?q=AI');
 * ```
 */
export interface ClientConfig {
  /** Wallet adapter that executes payments on behalf of the agent. */
  wallet: WalletAdapter;

  /** Spend governance policy. All checks are optional. */
  policy?: SpendPolicy;

  /** Subscription optimization settings. */
  subscription?: SubscriptionConfig;

  /**
   * Called after every successful payment with the structured receipt.
   * Use this for logging, cost attribution, or analytics.
   */
  onReceipt?: (receipt: AgentPaymentReceipt) => void;

  /**
   * Called when a payment is denied by the policy engine.
   * Use this for alerting or manual approval workflows.
   *
   * @param reason - Human-readable denial reason.
   * @param pricing - The pricing that was denied.
   */
  onPolicyDenied?: (reason: string, pricing: unknown) => void;

  /**
   * Optional external policy engine. If provided, overrides the inline
   * policy evaluation. Use this to integrate the standalone
   * `@openagentpay/policy` package for advanced policy rules.
   *
   * The engine must expose an `evaluate` method that returns an outcome.
   * When outcome is `"deny"`, the payment is rejected with a `PolicyDeniedError`.
   */
  policyEngine?: {
    evaluate: (request: {
      amount: string;
      currency: string;
      domain: string;
    }) => { outcome: string; reason?: string };
  };

  /** Retry behavior after payment. */
  retry?: {
    /**
     * Automatically retry the original request after successful payment.
     * Default: `true` (retry is always attempted in the standard flow).
     */
    autoRetry?: boolean;

    /**
     * Maximum number of retry attempts after payment failures.
     * Default: `1`.
     */
    maxRetries?: number;
  };
}

// ---------------------------------------------------------------------------
// PaidFetch Type
// ---------------------------------------------------------------------------

/**
 * A fetch function enhanced with automatic 402 payment handling.
 *
 * Has the same signature as the global `fetch` function. When the
 * upstream API returns 402 Payment Required, the wrapper transparently
 * parses the response, evaluates policy, executes payment, and retries
 * the request with the payment proof attached.
 */
export type PaidFetch = typeof globalThis.fetch;
