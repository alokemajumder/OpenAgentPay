/**
 * @module policy
 *
 * Types for the client-side policy engine — the agent's safety layer.
 *
 * The policy engine decides whether a payment should be approved
 * before it is executed. Without it, an agent with a funded wallet
 * is a liability: malicious APIs could overcharge, prompt injection
 * attacks could drain funds, and bugs could cause infinite loops.
 */

// ---------------------------------------------------------------------------
// Policy Rule
// ---------------------------------------------------------------------------

/**
 * Individual policy rule names used in decision logging.
 */
export type PolicyRule =
  | "max_per_request"
  | "max_per_day"
  | "max_per_session"
  | "max_per_provider"
  | "allowed_domains"
  | "blocked_domains"
  | "allowed_currencies"
  | "approval_threshold"
  | "max_subscription"
  | "max_subscription_period"
  | "test_mode";

// ---------------------------------------------------------------------------
// Policy Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the agent's spend governance policy engine.
 *
 * All monetary values are decimal strings (e.g. `"1.00"`).
 * All rules are optional — omitting a rule means no restriction.
 *
 * @example
 * ```typescript
 * const policy: PolicyConfig = {
 *   maxPerRequest: '1.00',
 *   maxPerDay: '50.00',
 *   allowedDomains: ['api.example.com', '*.trusted.dev'],
 *   approvalThreshold: '5.00',
 *   testMode: false,
 * };
 * ```
 */
export interface PolicyConfig {
  /** Maximum payment amount for a single API call (decimal string). */
  maxPerRequest?: string;

  /** Maximum total spend in a 24-hour rolling window (decimal string). */
  maxPerDay?: string;

  /** Maximum total spend in the current session (decimal string). */
  maxPerSession?: string;

  /** Maximum spend per unique provider domain per day (decimal string). */
  maxPerProvider?: string;

  /**
   * Glob patterns for approved domains.
   * If set, only matching domains are allowed.
   * Supports `*` wildcard (e.g. `"*.trusted.dev"`).
   */
  allowedDomains?: string[];

  /**
   * Glob patterns for blocked domains.
   * Checked before `allowedDomains`.
   */
  blockedDomains?: string[];

  /**
   * Currency codes the agent is permitted to pay with.
   * If set, only these currencies are allowed.
   */
  allowedCurrencies?: string[];

  /**
   * Amount above which human approval is required (decimal string).
   * Payments below this amount are auto-approved.
   */
  approvalThreshold?: string;

  /** Maximum single commitment for auto-subscribing (decimal string). */
  maxSubscription?: string;

  /** Whether the agent can automatically subscribe to plans. */
  autoSubscribe?: boolean;

  /**
   * Longest subscription period the agent is allowed to commit to.
   * @default `"month"`
   */
  maxSubscriptionPeriod?: "hour" | "day" | "week" | "month";

  /**
   * When `true`, only mock payment adapters are allowed.
   * Prevents accidental real-money transactions during development.
   */
  testMode?: boolean;
}

// ---------------------------------------------------------------------------
// Policy Decision
// ---------------------------------------------------------------------------

/**
 * The outcome of a policy evaluation.
 *
 * `"approve"` — payment is within policy, proceed automatically.
 * `"deny"` — payment violates policy, reject immediately.
 * `"require_approval"` — payment exceeds approval threshold, ask a human.
 */
export type PolicyDecisionOutcome = "approve" | "deny" | "require_approval";

/**
 * Full result of evaluating a payment against the policy engine.
 */
export interface PolicyEvaluation {
  /** The policy engine's decision. */
  outcome: PolicyDecisionOutcome;

  /** Which rules were evaluated during this check. */
  rules_evaluated: PolicyRule[];

  /** Human-readable reason for denial (if `outcome` is `"deny"`). */
  reason?: string;

  /** Which specific rule caused denial (if `outcome` is `"deny"`). */
  denied_by?: PolicyRule;

  /** Remaining daily budget after this payment (decimal string). */
  budget_remaining?: string;
}
