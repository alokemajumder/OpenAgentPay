/**
 * @module rules/approval-rules
 *
 * Approval threshold rule.
 *
 * When `approvalThreshold` is configured, payments at or above that
 * amount require human approval instead of being auto-approved.
 * This is the last rule checked — if all other rules pass but the
 * amount is high enough, the engine returns `require_approval`.
 */

import type { PolicyConfig, PolicyEvaluation, PolicyRule } from "@openagentpay/core";
import type { PaymentRequest } from "../engine.js";

const RULE: PolicyRule = "approval_threshold";

/**
 * Evaluate the approval threshold rule.
 *
 * If the payment amount is greater than or equal to `approvalThreshold`,
 * the payment requires human approval (returns `require_approval` instead
 * of `approve`).
 *
 * @param config - The policy configuration
 * @param request - The payment request to evaluate
 * @returns A `require_approval` evaluation if the threshold is met, or `null` if it passes
 */
export function evaluateApprovalThreshold(
  config: PolicyConfig,
  request: PaymentRequest,
): Partial<PolicyEvaluation> | null {
  if (config.approvalThreshold === undefined) {
    return null;
  }

  const amount = parseFloat(request.amount);
  const threshold = parseFloat(config.approvalThreshold);

  if (amount >= threshold) {
    return {
      outcome: "require_approval",
      reason: `Amount $${request.amount} meets or exceeds approval threshold ($${config.approvalThreshold})`,
    };
  }

  return null;
}

/** The rule name for logging purposes. */
export const approvalThresholdRule: PolicyRule = RULE;
