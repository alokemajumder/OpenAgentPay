/**
 * @module rules/amount-rules
 *
 * Amount-based policy rules: maxPerRequest, maxPerDay, maxPerSession, maxPerProvider.
 *
 * These rules enforce spending limits to prevent runaway agent spending.
 * Each rule compares the requested payment amount (plus any accumulated
 * spend) against the configured limit.
 */

import type { PolicyConfig, PolicyEvaluation, PolicyRule } from "@openagentpay/core";
import type { PaymentRequest } from "../engine.js";
import type { SpendTracker } from "../spend-tracker.js";

/**
 * Evaluate the max-per-request rule.
 *
 * Denies the payment if the requested amount exceeds the configured
 * `maxPerRequest` limit.
 *
 * @param config - The policy configuration
 * @param request - The payment request to evaluate
 * @returns A denial evaluation if the rule is violated, or `null` if it passes
 */
export function evaluateMaxPerRequest(
  config: PolicyConfig,
  request: PaymentRequest,
): Partial<PolicyEvaluation> | null {
  if (config.maxPerRequest === undefined) {
    return null;
  }

  const amount = parseFloat(request.amount);
  const limit = parseFloat(config.maxPerRequest);

  if (amount > limit) {
    return {
      outcome: "deny",
      reason: `Amount $${request.amount} exceeds maxPerRequest ($${config.maxPerRequest})`,
      denied_by: "max_per_request" as PolicyRule,
    };
  }

  return null;
}

/**
 * Evaluate the max-per-day rule.
 *
 * Denies the payment if the daily total (rolling 24h window)
 * plus the requested amount would exceed `maxPerDay`.
 *
 * @param config - The policy configuration
 * @param request - The payment request to evaluate
 * @param tracker - The spend tracker with current totals
 * @returns A denial evaluation if the rule is violated, or `null` if it passes
 */
export function evaluateMaxPerDay(
  config: PolicyConfig,
  request: PaymentRequest,
  tracker: SpendTracker,
): Partial<PolicyEvaluation> | null {
  if (config.maxPerDay === undefined) {
    return null;
  }

  const amount = parseFloat(request.amount);
  const dailyTotal = parseFloat(tracker.getDailyTotal());
  const limit = parseFloat(config.maxPerDay);

  if (dailyTotal + amount > limit) {
    return {
      outcome: "deny",
      reason: `Amount $${request.amount} would exceed maxPerDay ($${config.maxPerDay}). Daily total: $${tracker.getDailyTotal()}`,
      denied_by: "max_per_day" as PolicyRule,
    };
  }

  return null;
}

/**
 * Evaluate the max-per-session rule.
 *
 * Denies the payment if the cumulative session total plus the
 * requested amount would exceed `maxPerSession`.
 *
 * @param config - The policy configuration
 * @param request - The payment request to evaluate
 * @param tracker - The spend tracker with current totals
 * @returns A denial evaluation if the rule is violated, or `null` if it passes
 */
export function evaluateMaxPerSession(
  config: PolicyConfig,
  request: PaymentRequest,
  tracker: SpendTracker,
): Partial<PolicyEvaluation> | null {
  if (config.maxPerSession === undefined) {
    return null;
  }

  const amount = parseFloat(request.amount);
  const sessionTotal = parseFloat(tracker.getSessionTotal());
  const limit = parseFloat(config.maxPerSession);

  if (sessionTotal + amount > limit) {
    return {
      outcome: "deny",
      reason: `Amount $${request.amount} would exceed maxPerSession ($${config.maxPerSession}). Session total: $${tracker.getSessionTotal()}`,
      denied_by: "max_per_session" as PolicyRule,
    };
  }

  return null;
}

/**
 * Evaluate the max-per-provider rule.
 *
 * Denies the payment if the per-provider daily total plus the
 * requested amount would exceed `maxPerProvider`.
 *
 * @param config - The policy configuration
 * @param request - The payment request to evaluate
 * @param tracker - The spend tracker with current totals
 * @returns A denial evaluation if the rule is violated, or `null` if it passes
 */
export function evaluateMaxPerProvider(
  config: PolicyConfig,
  request: PaymentRequest,
  tracker: SpendTracker,
): Partial<PolicyEvaluation> | null {
  if (config.maxPerProvider === undefined) {
    return null;
  }

  if (!request.domain) {
    return null; // No domain — cannot enforce per-provider limit
  }

  const amount = parseFloat(request.amount);
  const providerTotal = parseFloat(tracker.getProviderTotal(request.domain));
  const limit = parseFloat(config.maxPerProvider);

  if (providerTotal + amount > limit) {
    return {
      outcome: "deny",
      reason: `Amount $${request.amount} would exceed maxPerProvider ($${config.maxPerProvider}) for '${request.domain}'. Provider total: $${tracker.getProviderTotal(request.domain)}`,
      denied_by: "max_per_provider" as PolicyRule,
    };
  }

  return null;
}
