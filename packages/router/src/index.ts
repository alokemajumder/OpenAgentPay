/**
 * @openagentpay/router
 *
 * Intelligent payment routing engine for OpenAgentPay.
 *
 * Selects the optimal payment adapter based on cost, success rate,
 * latency, and policy constraints — transforming OpenAgentPay from
 * a static multi-adapter SDK into a true payment orchestrator.
 *
 * @packageDocumentation
 */

// Main class
export { SmartRouter } from './router.js';

// Supporting classes
export { HealthTracker } from './health.js';
export { CostEstimator } from './cost.js';
export { CascadeManager } from './cascade.js';

// Types
export type {
  RouterConfig,
  RoutingStrategy,
  AdapterEntry,
  AdapterHealth,
  CostEstimate,
  RouteDecision,
  RouteRequest,
  CascadeAttempt,
  CascadeResult,
} from './types.js';

// Strategy configuration types
export type {
  RoutingRule,
  AmountTier,
  RegionPreference,
  TimeWindow,
  CustomScoringFn,
} from './strategies.js';

// Factory function
import type { RouterConfig } from './types.js';
import { SmartRouter } from './router.js';

/**
 * Create a new SmartRouter instance.
 *
 * @example
 * ```typescript
 * import { createRouter } from '@openagentpay/router';
 *
 * const router = createRouter({
 *   adapters: [
 *     { adapter: mppAdapter, priority: 1, costPerTransaction: '0.001' },
 *     { adapter: stripeAdapter, priority: 3, costPerTransaction: '0.30', costPercentage: 2.9 },
 *   ],
 *   strategy: 'smart',
 *   cascade: true,
 * });
 *
 * const decision = router.select({ amount: '0.01', currency: 'USDC' });
 * ```
 */
export function createRouter(config: RouterConfig): SmartRouter {
  return new SmartRouter(config);
}
