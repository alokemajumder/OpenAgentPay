/**
 * @openagentpay/policy
 *
 * Spend governance policy engine for OpenAgentPay.
 *
 * This package is the AI agent's safety layer — it evaluates every
 * payment request against configurable rules before execution.
 * Without it, an agent with a funded wallet is a liability.
 *
 * @example
 * ```typescript
 * import { createPolicy } from '@openagentpay/policy';
 *
 * const policy = createPolicy({
 *   maxPerRequest: '1.00',
 *   maxPerDay: '50.00',
 *   allowedDomains: ['api.example.com', '*.trusted.dev'],
 *   approvalThreshold: '5.00',
 * });
 *
 * const result = policy.evaluate({
 *   amount: '0.50',
 *   currency: 'USDC',
 *   domain: 'api.example.com',
 * });
 *
 * if (result.outcome === 'approve') {
 *   // Proceed with payment
 *   policy.recordSpend('api.example.com', '0.50');
 * }
 * ```
 *
 * @packageDocumentation
 */

import type { PolicyConfig } from "@openagentpay/core";
import { PolicyEngine } from "./engine.js";

export { PolicyEngine } from "./engine.js";
export type { PaymentRequest } from "./engine.js";
export { SpendTracker } from "./spend-tracker.js";
export { globMatch, globMatchAny } from "./glob.js";

/**
 * Create a new policy engine with the given configuration.
 *
 * This is the recommended entry point for creating a PolicyEngine.
 * It provides a clean factory function that reads well in agent
 * initialization code.
 *
 * @param config - The spend governance policy configuration
 * @returns A configured PolicyEngine instance
 *
 * @example
 * ```typescript
 * const policy = createPolicy({
 *   maxPerRequest: '1.00',
 *   maxPerDay: '50.00',
 *   allowedDomains: ['*.trusted.dev'],
 *   testMode: false,
 * });
 * ```
 */
export function createPolicy(config: PolicyConfig): PolicyEngine {
  return new PolicyEngine(config);
}
