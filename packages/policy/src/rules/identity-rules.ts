/**
 * @module rules/identity-rules
 *
 * Identity-based policy rule: identityRequired.
 *
 * When enabled, this rule requires payment requests to include
 * valid agent attestations. It can optionally require specific
 * attestation types (e.g., 'payment-authorization', 'identity').
 */

import type { PolicyConfig, PolicyEvaluation, PolicyRule, AgentAttestation } from "@openagentpay/core";
import type { PaymentRequest } from "../engine.js";

const IDENTITY_RULE: PolicyRule = "identity_required";

/**
 * Evaluate the identity-required rule.
 *
 * When `identityRequired` is set in the policy config:
 * - If `true`, at least one non-expired attestation must be present.
 * - If an array of strings, at least one non-expired attestation of
 *   each listed type must be present.
 *
 * This rule does NOT verify cryptographic signatures — it only checks
 * structural validity and expiry. Signature verification should be
 * done by the caller using {@link AgentIdentityManager.verifyAttestation}
 * before passing attestations into the policy engine.
 *
 * @param config - The policy configuration
 * @param request - The payment request to evaluate
 * @returns A denial evaluation if identity requirements are not met, or `null` if it passes
 */
export function evaluateIdentityRequired(
  config: PolicyConfig,
  request: PaymentRequest,
): Partial<PolicyEvaluation> | null {
  if (!config.identityRequired) {
    return null; // Rule not configured
  }

  const attestations = (request as PaymentRequest & { attestations?: AgentAttestation[] }).attestations;

  // Check that attestations are present
  if (!attestations || attestations.length === 0) {
    return {
      outcome: "deny",
      reason: "Payment request requires agent identity attestation(s) but none were provided",
      denied_by: IDENTITY_RULE,
    };
  }

  // Filter out expired attestations
  const now = Date.now();
  const validAttestations = attestations.filter((a) => {
    if (!a.expiresAt) return true;
    return new Date(a.expiresAt).getTime() > now;
  });

  if (validAttestations.length === 0) {
    return {
      outcome: "deny",
      reason: "All provided agent attestations have expired",
      denied_by: IDENTITY_RULE,
    };
  }

  // If specific attestation types are required, check each one
  if (Array.isArray(config.identityRequired)) {
    const requiredTypes = config.identityRequired;
    const presentTypes = new Set(validAttestations.map((a) => a.type));

    const missingTypes = requiredTypes.filter((t) => !presentTypes.has(t));

    if (missingTypes.length > 0) {
      return {
        outcome: "deny",
        reason: `Missing required attestation type(s): ${missingTypes.join(", ")}`,
        denied_by: IDENTITY_RULE,
      };
    }
  }

  return null;
}

/** Rule name for logging purposes. */
export const identityRequiredRule: PolicyRule = IDENTITY_RULE;
