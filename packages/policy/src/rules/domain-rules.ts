/**
 * @module rules/domain-rules
 *
 * Domain-based policy rules: blockedDomains and allowedDomains.
 *
 * These rules control which API provider domains the agent is
 * permitted to pay. Blocked domains are checked first (deny-list),
 * then allowed domains (allow-list).
 */

import type { PolicyConfig, PolicyEvaluation, PolicyRule } from "@openagentpay/core";
import type { PaymentRequest } from "../engine.js";
import { globMatchAny } from "../glob.js";

const BLOCKED_RULE: PolicyRule = "blocked_domains";
const ALLOWED_RULE: PolicyRule = "allowed_domains";

/**
 * Evaluate the blocked domains rule.
 *
 * If the payment request's domain matches any pattern in `blockedDomains`,
 * the payment is denied immediately.
 *
 * @param config - The policy configuration
 * @param request - The payment request to evaluate
 * @returns A denial evaluation if the domain is blocked, or `null` if it passes
 */
export function evaluateBlockedDomains(
  config: PolicyConfig,
  request: PaymentRequest,
): Partial<PolicyEvaluation> | null {
  if (!config.blockedDomains || config.blockedDomains.length === 0) {
    return null; // Rule not configured
  }

  if (!request.domain) {
    return null; // No domain to check
  }

  if (globMatchAny(config.blockedDomains, request.domain)) {
    return {
      outcome: "deny",
      reason: `Domain '${request.domain}' is blocked by policy`,
      denied_by: BLOCKED_RULE,
    };
  }

  return null;
}

/**
 * Evaluate the allowed domains rule.
 *
 * If `allowedDomains` is configured and the payment request's domain
 * does NOT match any pattern, the payment is denied.
 *
 * @param config - The policy configuration
 * @param request - The payment request to evaluate
 * @returns A denial evaluation if the domain is not allowed, or `null` if it passes
 */
export function evaluateAllowedDomains(
  config: PolicyConfig,
  request: PaymentRequest,
): Partial<PolicyEvaluation> | null {
  if (!config.allowedDomains || config.allowedDomains.length === 0) {
    return null; // Rule not configured — all domains allowed
  }

  if (!request.domain) {
    return {
      outcome: "deny",
      reason: "Payment has no domain but allowedDomains policy is configured",
      denied_by: ALLOWED_RULE,
    };
  }

  if (!globMatchAny(config.allowedDomains, request.domain)) {
    return {
      outcome: "deny",
      reason: `Domain '${request.domain}' is not in the allowed domains list`,
      denied_by: ALLOWED_RULE,
    };
  }

  return null;
}

/** Rule names for logging purposes. */
export const blockedDomainsRule: PolicyRule = BLOCKED_RULE;
export const allowedDomainsRule: PolicyRule = ALLOWED_RULE;
