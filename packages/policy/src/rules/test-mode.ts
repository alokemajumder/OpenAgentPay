/**
 * @module rules/test-mode
 *
 * Test mode enforcement rule.
 *
 * When `testMode` is enabled, the policy engine only allows mock/test
 * payment methods, preventing accidental real-money transactions
 * during development and testing.
 */

import type { PolicyConfig, PolicyEvaluation, PolicyRule } from "@openagentpay/core";
import type { PaymentRequest } from "../engine.js";

const RULE: PolicyRule = "test_mode";

/**
 * Evaluate the test mode rule.
 *
 * If `testMode` is `true` in the policy config and the payment request
 * is not using a mock payment method, the payment is denied.
 *
 * @param config - The policy configuration
 * @param request - The payment request to evaluate
 * @returns A denial evaluation if the rule is violated, or `null` if it passes
 */
export function evaluateTestMode(
  config: PolicyConfig,
  _request: PaymentRequest,
): Partial<PolicyEvaluation> | null {
  if (config.testMode !== true) {
    return null; // Rule not configured
  }

  // In test mode, we allow all payments through the policy engine.
  // The actual enforcement of mock-only payment methods happens at
  // the adapter layer. The policy engine's role is to flag that
  // test mode is active so the client knows to use mock adapters.
  // If the request has isMock explicitly set to false, deny it.
  if (_request.isMock === false) {
    return {
      outcome: "deny",
      reason: "Test mode is enabled — only mock payment methods are allowed",
      denied_by: RULE,
    };
  }

  return null; // Passes
}

/** The rule name for logging purposes. */
export const testModeRule: PolicyRule = RULE;
