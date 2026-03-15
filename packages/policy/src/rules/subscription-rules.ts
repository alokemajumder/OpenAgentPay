/**
 * @module rules/subscription-rules
 *
 * Subscription-related policy rules: maxSubscription, maxSubscriptionPeriod, autoSubscribe.
 *
 * These rules govern whether the agent is allowed to commit to
 * recurring payments (subscriptions) and under what constraints.
 */

import type { PolicyConfig, PolicyEvaluation, PolicyRule } from "@openagentpay/core";
import type { PaymentRequest } from "../engine.js";

/** Ordered list of subscription periods from shortest to longest. */
const PERIOD_ORDER: Array<"hour" | "day" | "week" | "month"> = [
  "hour",
  "day",
  "week",
  "month",
];

/**
 * Evaluate the max subscription amount rule.
 *
 * If the payment is a subscription and the amount exceeds
 * `maxSubscription`, the payment is denied.
 *
 * @param config - The policy configuration
 * @param request - The payment request to evaluate
 * @returns A denial evaluation if the rule is violated, or `null` if it passes
 */
export function evaluateMaxSubscription(
  config: PolicyConfig,
  request: PaymentRequest,
): Partial<PolicyEvaluation> | null {
  if (config.maxSubscription === undefined) {
    return null;
  }

  if (!request.isSubscription) {
    return null; // Not a subscription — rule doesn't apply
  }

  const amount = parseFloat(request.amount);
  const limit = parseFloat(config.maxSubscription);

  if (amount > limit) {
    return {
      outcome: "deny",
      reason: `Subscription amount $${request.amount} exceeds maxSubscription ($${config.maxSubscription})`,
      denied_by: "max_subscription" as PolicyRule,
    };
  }

  return null;
}

/**
 * Evaluate the max subscription period rule.
 *
 * If the payment is a subscription and the requested period is longer
 * than `maxSubscriptionPeriod`, the payment is denied.
 *
 * @param config - The policy configuration
 * @param request - The payment request to evaluate
 * @returns A denial evaluation if the rule is violated, or `null` if it passes
 */
export function evaluateMaxSubscriptionPeriod(
  config: PolicyConfig,
  request: PaymentRequest,
): Partial<PolicyEvaluation> | null {
  if (config.maxSubscriptionPeriod === undefined) {
    return null;
  }

  if (!request.isSubscription || !request.subscriptionPeriod) {
    return null; // Not a subscription or no period specified
  }

  const maxIndex = PERIOD_ORDER.indexOf(config.maxSubscriptionPeriod);
  const requestIndex = PERIOD_ORDER.indexOf(request.subscriptionPeriod);

  if (requestIndex === -1) {
    return {
      outcome: "deny",
      reason: `Unknown subscription period '${request.subscriptionPeriod}'`,
      denied_by: "max_subscription_period" as PolicyRule,
    };
  }

  if (requestIndex > maxIndex) {
    return {
      outcome: "deny",
      reason: `Subscription period '${request.subscriptionPeriod}' exceeds maxSubscriptionPeriod ('${config.maxSubscriptionPeriod}')`,
      denied_by: "max_subscription_period" as PolicyRule,
    };
  }

  return null;
}
