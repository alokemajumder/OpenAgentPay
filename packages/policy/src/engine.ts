/**
 * @module engine
 *
 * The core policy engine — evaluates payment requests against
 * configured spend governance rules.
 *
 * This is safety-critical code. The PolicyEngine is the last line
 * of defense between an AI agent and an unbounded wallet drain.
 * Every payment MUST pass through `evaluate()` before execution.
 */

import type {
  PolicyConfig,
  PolicyEvaluation,
  PolicyRule,
} from "@openagentpay/core";

import { SpendTracker } from "./spend-tracker.js";
import {
  evaluateTestMode,
  evaluateBlockedDomains,
  evaluateAllowedDomains,
  evaluateAllowedCurrencies,
  evaluateMaxPerRequest,
  evaluateMaxPerDay,
  evaluateMaxPerSession,
  evaluateMaxPerProvider,
  evaluateMaxSubscription,
  evaluateMaxSubscriptionPeriod,
  evaluateApprovalThreshold,
} from "./rules/index.js";

// ---------------------------------------------------------------------------
// Payment Request
// ---------------------------------------------------------------------------

/**
 * A payment request to be evaluated by the policy engine.
 *
 * This represents the payment the agent is about to make.
 * The engine decides whether to approve, deny, or require approval.
 */
export interface PaymentRequest {
  /** The payment amount as a decimal string (e.g., `"0.50"`). */
  amount: string;

  /** The currency code (e.g., `"USDC"`, `"USD"`). */
  currency?: string;

  /** The API provider's domain (e.g., `"api.example.com"`). */
  domain?: string;

  /** Whether this payment is for a subscription. */
  isSubscription?: boolean;

  /** The subscription billing period, if applicable. */
  subscriptionPeriod?: "hour" | "day" | "week" | "month";

  /**
   * Whether this is a mock/test payment.
   * Set to `false` explicitly to indicate a real payment.
   * When `testMode` is enabled, real payments are denied.
   */
  isMock?: boolean;
}

// ---------------------------------------------------------------------------
// PolicyEngine
// ---------------------------------------------------------------------------

/**
 * The spend governance policy engine.
 *
 * Evaluates payment requests against a set of configurable rules
 * to prevent runaway AI agent spending. Rules are evaluated in a
 * strict order, and the first rule to deny stops evaluation.
 *
 * Rule evaluation order:
 * 1. `testMode` — reject non-mock payments in test mode
 * 2. `blockedDomains` — deny blocked domains
 * 3. `allowedDomains` — deny domains not in allow-list
 * 4. `allowedCurrencies` — deny disallowed currencies
 * 5. `maxPerRequest` — deny amounts exceeding per-request limit
 * 6. `maxPerDay` — deny if daily budget would be exceeded
 * 7. `maxPerSession` — deny if session budget would be exceeded
 * 8. `maxPerProvider` — deny if per-provider budget would be exceeded
 * 9. `maxSubscription` — deny subscriptions exceeding limit
 * 10. `maxSubscriptionPeriod` — deny subscriptions with too-long periods
 * 11. `approvalThreshold` — require human approval for large amounts
 * 12. All pass — approve
 *
 * @example
 * ```typescript
 * const engine = new PolicyEngine({
 *   maxPerRequest: '1.00',
 *   maxPerDay: '50.00',
 *   allowedDomains: ['api.example.com'],
 * });
 *
 * const result = engine.evaluate({
 *   amount: '0.50',
 *   currency: 'USDC',
 *   domain: 'api.example.com',
 * });
 *
 * if (result.outcome === 'approve') {
 *   // Proceed with payment, then record it
 *   engine.recordSpend('api.example.com', '0.50');
 * }
 * ```
 */
export class PolicyEngine {
  private readonly config: PolicyConfig;
  private readonly tracker: SpendTracker;

  /**
   * Create a new PolicyEngine with the given configuration.
   *
   * @param config - The spend governance policy configuration
   */
  constructor(config: PolicyConfig) {
    this.config = config;
    this.tracker = new SpendTracker();
  }

  /**
   * Evaluate a payment request against all configured policy rules.
   *
   * Rules are evaluated in strict order. The first rule to deny
   * the payment short-circuits evaluation and returns immediately.
   * If all rules pass, the payment is approved.
   *
   * @param request - The payment request to evaluate
   * @returns The policy evaluation result
   */
  evaluate(request: PaymentRequest): PolicyEvaluation {
    const rulesEvaluated: PolicyRule[] = [];

    // Define the evaluation pipeline in strict order.
    // Each entry is: [rule name, evaluator function]
    type RuleEvaluator = () => Partial<PolicyEvaluation> | null;

    const pipeline: Array<[PolicyRule, RuleEvaluator]> = [
      ["test_mode", () => evaluateTestMode(this.config, request)],
      ["blocked_domains", () => evaluateBlockedDomains(this.config, request)],
      ["allowed_domains", () => evaluateAllowedDomains(this.config, request)],
      ["allowed_currencies", () => evaluateAllowedCurrencies(this.config, request)],
      ["max_per_request", () => evaluateMaxPerRequest(this.config, request)],
      ["max_per_day", () => evaluateMaxPerDay(this.config, request, this.tracker)],
      ["max_per_session", () => evaluateMaxPerSession(this.config, request, this.tracker)],
      ["max_per_provider", () => evaluateMaxPerProvider(this.config, request, this.tracker)],
      ["max_subscription", () => evaluateMaxSubscription(this.config, request)],
      ["max_subscription_period", () => evaluateMaxSubscriptionPeriod(this.config, request)],
      ["approval_threshold", () => evaluateApprovalThreshold(this.config, request)],
    ];

    for (const [ruleName, evaluator] of pipeline) {
      rulesEvaluated.push(ruleName);
      const result = evaluator();

      if (result !== null) {
        // Rule triggered — return the result with all evaluated rules
        const evaluation: PolicyEvaluation = {
          outcome: result.outcome!,
          rules_evaluated: rulesEvaluated,
        };

        if (result.reason) {
          evaluation.reason = result.reason;
        }

        if (result.denied_by) {
          evaluation.denied_by = result.denied_by;
        }

        // Calculate budget remaining for denials too
        if (this.config.maxPerDay !== undefined) {
          const dailyTotal = parseFloat(this.tracker.getDailyTotal());
          const maxPerDay = parseFloat(this.config.maxPerDay);
          const remaining = Math.max(0, maxPerDay - dailyTotal);
          evaluation.budget_remaining = remaining.toFixed(2);
        }

        return evaluation;
      }
    }

    // All rules passed — approve
    const evaluation: PolicyEvaluation = {
      outcome: "approve",
      rules_evaluated: rulesEvaluated,
    };

    if (this.config.maxPerDay !== undefined) {
      const dailyTotal = parseFloat(this.tracker.getDailyTotal());
      const maxPerDay = parseFloat(this.config.maxPerDay);
      const remaining = Math.max(0, maxPerDay - dailyTotal - parseFloat(request.amount));
      evaluation.budget_remaining = remaining.toFixed(2);
    }

    return evaluation;
  }

  /**
   * Record a completed payment in the spend tracker.
   *
   * Call this AFTER a payment has been successfully executed.
   * This updates the daily, session, and per-provider totals
   * used by subsequent `evaluate()` calls.
   *
   * @param domain - The provider domain that received the payment
   * @param amount - The amount paid as a decimal string
   */
  recordSpend(domain: string, amount: string): void {
    this.tracker.record(domain, amount);
  }

  /**
   * Get the total amount spent in the last 24 hours.
   *
   * @returns Daily total as a decimal string (e.g., `"4.30"`)
   */
  getDailyTotal(): string {
    return this.tracker.getDailyTotal();
  }

  /**
   * Get the cumulative amount spent in the current session.
   *
   * @returns Session total as a decimal string (e.g., `"12.50"`)
   */
  getSessionTotal(): string {
    return this.tracker.getSessionTotal();
  }

  /**
   * Get the total amount spent on a specific provider in the last 24 hours.
   *
   * @param domain - The provider domain to query
   * @returns Provider total as a decimal string (e.g., `"2.00"`)
   */
  getProviderTotal(domain: string): string {
    return this.tracker.getProviderTotal(domain);
  }

  /**
   * Reset all spend tracking state.
   *
   * Clears daily, session, and per-provider totals.
   * Useful for testing or when starting a new agent session.
   */
  reset(): void {
    this.tracker.reset();
  }

  /**
   * Get the current policy configuration (read-only).
   *
   * @returns A frozen copy of the policy configuration
   */
  getConfig(): Readonly<PolicyConfig> {
    return Object.freeze({ ...this.config });
  }
}
