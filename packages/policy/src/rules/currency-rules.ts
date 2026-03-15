/**
 * @module rules/currency-rules
 *
 * Currency filter rule.
 *
 * When `allowedCurrencies` is configured, only payments in those
 * currencies are permitted. This prevents the agent from paying
 * in unexpected or risky currencies.
 */

import type { PolicyConfig, PolicyEvaluation, PolicyRule } from "@openagentpay/core";
import type { PaymentRequest } from "../engine.js";

const RULE: PolicyRule = "allowed_currencies";

/**
 * Evaluate the allowed currencies rule.
 *
 * If `allowedCurrencies` is configured and the payment's currency
 * is not in the list, the payment is denied.
 *
 * @param config - The policy configuration
 * @param request - The payment request to evaluate
 * @returns A denial evaluation if the currency is not allowed, or `null` if it passes
 */
export function evaluateAllowedCurrencies(
  config: PolicyConfig,
  request: PaymentRequest,
): Partial<PolicyEvaluation> | null {
  if (!config.allowedCurrencies || config.allowedCurrencies.length === 0) {
    return null; // Rule not configured — all currencies allowed
  }

  if (!request.currency) {
    return {
      outcome: "deny",
      reason: "Payment has no currency but allowedCurrencies policy is configured",
      denied_by: RULE,
    };
  }

  const normalized = config.allowedCurrencies.map((c) => c.toUpperCase());
  if (!normalized.includes(request.currency.toUpperCase())) {
    return {
      outcome: "deny",
      reason: `Currency '${request.currency}' is not in the allowed currencies list (${config.allowedCurrencies.join(", ")})`,
      denied_by: RULE,
    };
  }

  return null;
}

/** The rule name for logging purposes. */
export const allowedCurrenciesRule: PolicyRule = RULE;
