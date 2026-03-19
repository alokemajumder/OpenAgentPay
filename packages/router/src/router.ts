/**
 * @module router
 *
 * SmartRouter — the intelligent routing engine that selects the
 * optimal payment adapter based on cost, success rate, latency,
 * and policy constraints.
 *
 * This is the brain of OpenAgentPay's payment orchestration layer.
 */

import type { PaymentAdapter } from '@openagentpay/core';

import type {
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

import { HealthTracker } from './health.js';
import { CostEstimator } from './cost.js';
import { CascadeManager } from './cascade.js';
import {
  priorityStrategy,
  lowestCostStrategy,
  highestSuccessStrategy,
  lowestLatencyStrategy,
  roundRobinStrategy,
  weightedStrategy,
  smartStrategy,
  adaptiveStrategy,
  conditionalStrategy,
  amountTieredStrategy,
  geoAwareStrategy,
  timeAwareStrategy,
  failoverOnlyStrategy,
  customStrategy,
} from './strategies.js';

// ---------------------------------------------------------------------------
// SmartRouter
// ---------------------------------------------------------------------------

/**
 * Intelligent payment adapter router.
 *
 * Evaluates registered adapters based on the configured strategy
 * (cost, health, latency, or a composite "smart" score) and returns
 * the best adapter for each payment request. Supports automatic
 * cascade/failover when the primary adapter fails.
 *
 * @example
 * ```typescript
 * const router = new SmartRouter({
 *   adapters: [
 *     { adapter: mppAdapter, priority: 1, costPerTransaction: '0.001' },
 *     { adapter: stripeAdapter, priority: 3, costPerTransaction: '0.30', costPercentage: 2.9, minimumAmount: '0.50' },
 *   ],
 *   strategy: 'smart',
 *   cascade: true,
 * });
 *
 * const decision = router.select({ amount: '0.01', currency: 'USDC' });
 * ```
 */
export class SmartRouter {
  private readonly config: Required<
    Pick<RouterConfig, 'strategy' | 'cascade' | 'maxCascadeAttempts' | 'healthWindowMs' | 'minSuccessRate' | 'explorationRate' | 'probeInterval'>
  > & Pick<RouterConfig, 'adapters' | 'rules' | 'amountTiers' | 'regionPreferences' | 'timeWindows' | 'customScoring'>;

  private readonly healthTracker: HealthTracker;
  private readonly costEstimator: CostEstimator;
  private readonly cascadeManager: CascadeManager;

  /** Round-robin counter — persists across calls. */
  private roundRobinCounter = { value: 0 };

  /** Failover-only probe counter — persists across calls. */
  private probeCounter = { value: 0 };

  constructor(config: RouterConfig) {
    if (!config.adapters || config.adapters.length === 0) {
      throw new Error('RouterConfig.adapters must contain at least one adapter');
    }

    this.config = {
      adapters: config.adapters,
      strategy: config.strategy ?? 'priority',
      cascade: config.cascade ?? false,
      maxCascadeAttempts: config.maxCascadeAttempts ?? 3,
      healthWindowMs: config.healthWindowMs ?? 300_000,
      minSuccessRate: config.minSuccessRate ?? 0.5,
      explorationRate: config.explorationRate ?? 0.1,
      probeInterval: config.probeInterval ?? 20,
      rules: config.rules,
      amountTiers: config.amountTiers,
      regionPreferences: config.regionPreferences,
      timeWindows: config.timeWindows,
      customScoring: config.customScoring,
    };

    this.healthTracker = new HealthTracker(this.config.healthWindowMs);
    this.costEstimator = new CostEstimator();
    this.cascadeManager = new CascadeManager(this.config.maxCascadeAttempts);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Select the best adapter for a payment request.
   *
   * Applies filtering (enabled, currency, region, amount bounds),
   * then runs the configured routing strategy to pick the optimal
   * adapter. Returns a full `RouteDecision` with the selected
   * adapter, reason, cost estimate, health, and alternatives.
   */
  select(request: RouteRequest, strategy?: RoutingStrategy): RouteDecision {
    const effectiveStrategy = strategy ?? this.config.strategy;
    const eligible = this.filterEligible(request);

    if (eligible.length === 0) {
      throw new Error(
        `No eligible adapters for request: amount=${request.amount}, currency=${request.currency}`,
      );
    }

    const ranked = this.applyStrategy(eligible, request, effectiveStrategy);

    if (ranked.length === 0) {
      throw new Error(
        `All adapters were filtered out by strategy "${effectiveStrategy}" for request: amount=${request.amount}, currency=${request.currency}`,
      );
    }

    const selectedAdapter = ranked[0]!;
    const selectedEntry = eligible.find((e) => e.adapter.type === selectedAdapter.type);
    const costEstimate = this.costEstimator.estimateCost(
      selectedEntry ?? eligible[0]!,
      request.amount,
      request.currency,
    );
    const health = this.healthTracker.getHealth(selectedAdapter.type);

    const reason = this.buildReason(selectedAdapter, costEstimate, health, effectiveStrategy, request);

    return {
      adapter: selectedAdapter,
      reason,
      estimatedCost: costEstimate,
      health,
      alternatives: ranked.slice(1),
      strategy: effectiveStrategy,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get an ordered list of adapters for a request (for manual cascade).
   * Applies filtering and the configured strategy.
   */
  rank(request: RouteRequest, strategy?: RoutingStrategy): PaymentAdapter[] {
    const effectiveStrategy = strategy ?? this.config.strategy;
    const eligible = this.filterEligible(request);
    return this.applyStrategy(eligible, request, effectiveStrategy);
  }

  /**
   * Record a successful payment for an adapter (feeds health tracking).
   */
  recordSuccess(
    adapterType: string,
    details: { latencyMs: number; amount?: string },
  ): void {
    this.healthTracker.recordSuccess(adapterType, details.latencyMs);
  }

  /**
   * Record a failed payment for an adapter (feeds health tracking).
   */
  recordFailure(
    adapterType: string,
    details: { error?: string; amount?: string },
  ): void {
    this.healthTracker.recordFailure(adapterType, details.error);
  }

  /**
   * Get health metrics for a single adapter.
   */
  getHealth(adapterType: string): AdapterHealth {
    return this.healthTracker.getHealth(adapterType);
  }

  /**
   * Get health metrics for all tracked adapters.
   */
  getAllHealth(): Map<string, AdapterHealth> {
    return this.healthTracker.getAllHealth();
  }

  /**
   * Estimate cost for a specific adapter entry.
   */
  estimateCost(entry: AdapterEntry, amount: string, currency: string): CostEstimate {
    return this.costEstimator.estimateCost(entry, amount, currency);
  }

  /**
   * Execute a payment with automatic cascade/failover.
   *
   * Ranks adapters for the request, then tries each in order
   * until one succeeds or maxCascadeAttempts is exhausted.
   * Automatically records success/failure for health tracking.
   */
  async executeWithCascade(
    request: RouteRequest,
    executePayment: (adapter: PaymentAdapter) => Promise<{ success: boolean; error?: string }>,
    onAttempt?: (adapter: PaymentAdapter, attemptNumber: number) => void,
  ): Promise<CascadeResult> {
    const ranked = this.rank(request);

    const result = await this.cascadeManager.executeWithCascade(
      ranked,
      async (adapter) => {
        const outcome = await executePayment(adapter);
        return outcome;
      },
      onAttempt,
    );

    // Record health data from all attempts
    for (const attempt of result.attempts) {
      if (attempt.success) {
        this.healthTracker.recordSuccess(attempt.adapterType, attempt.latencyMs);
      } else {
        this.healthTracker.recordFailure(attempt.adapterType, attempt.error);
      }
    }

    return result;
  }

  /**
   * Reset health tracking data.
   */
  resetHealth(adapterType?: string): void {
    this.healthTracker.reset(adapterType);
  }

  /**
   * Get the current router configuration.
   */
  getConfig(): RouterConfig {
    return { ...this.config };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Filter adapter entries to those eligible for the given request:
   * - Must be enabled
   * - Must support the requested currency (if currencies are specified)
   * - Must support the requested region (if regions are specified)
   * - Transaction amount must be within [minimumAmount, maximumAmount]
   */
  private filterEligible(request: RouteRequest): AdapterEntry[] {
    const amount = parseFloat(request.amount);
    const upperCurrency = request.currency.toUpperCase();

    return this.config.adapters.filter((entry) => {
      // Disabled adapters are excluded
      if (entry.enabled === false) return false;

      // Currency filter
      if (entry.currencies && entry.currencies.length > 0) {
        if (!entry.currencies.some((c) => c.toUpperCase() === upperCurrency)) {
          return false;
        }
      }

      // Region filter
      if (request.region && entry.regions && entry.regions.length > 0) {
        const upperRegion = request.region.toUpperCase();
        if (!entry.regions.some((r) => r.toUpperCase() === upperRegion)) {
          return false;
        }
      }

      // Minimum amount filter
      if (entry.minimumAmount) {
        if (amount < parseFloat(entry.minimumAmount)) {
          return false;
        }
      }

      // Maximum amount filter
      if (entry.maximumAmount) {
        if (amount > parseFloat(entry.maximumAmount)) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Apply the specified routing strategy to the eligible entries.
   */
  private applyStrategy(
    entries: AdapterEntry[],
    request: RouteRequest,
    strategy: RoutingStrategy,
  ): PaymentAdapter[] {
    switch (strategy) {
      case 'priority':
        return priorityStrategy(entries, request, this.healthTracker, this.costEstimator);

      case 'lowest-cost':
        return lowestCostStrategy(entries, request, this.healthTracker, this.costEstimator);

      case 'highest-success':
        return highestSuccessStrategy(
          entries, request, this.healthTracker, this.costEstimator, this.config.minSuccessRate,
        );

      case 'lowest-latency':
        return lowestLatencyStrategy(entries, request, this.healthTracker, this.costEstimator);

      case 'round-robin':
        return roundRobinStrategy(
          entries, request, this.healthTracker, this.costEstimator,
          this.roundRobinCounter, this.config.minSuccessRate,
        );

      case 'weighted':
        return weightedStrategy(
          entries, request, this.healthTracker, this.costEstimator, this.config.minSuccessRate,
        );

      case 'smart':
        return smartStrategy(
          entries, request, this.healthTracker, this.costEstimator, this.config.minSuccessRate,
        );

      case 'adaptive':
        return adaptiveStrategy(
          entries, request, this.healthTracker, this.costEstimator,
          this.config.minSuccessRate, this.config.explorationRate,
        );

      case 'conditional':
        return conditionalStrategy(
          entries, request, this.healthTracker, this.costEstimator,
          this.config.rules ?? [], this.config.minSuccessRate,
        );

      case 'amount-tiered':
        return amountTieredStrategy(
          entries, request, this.healthTracker, this.costEstimator,
          this.config.amountTiers ?? [], this.config.minSuccessRate,
        );

      case 'geo-aware':
        return geoAwareStrategy(
          entries, request, this.healthTracker, this.costEstimator,
          this.config.regionPreferences ?? [], this.config.minSuccessRate,
        );

      case 'time-aware':
        return timeAwareStrategy(
          entries, request, this.healthTracker, this.costEstimator,
          this.config.timeWindows ?? [], this.config.minSuccessRate,
        );

      case 'failover-only':
        return failoverOnlyStrategy(
          entries, request, this.healthTracker, this.costEstimator,
          this.config.minSuccessRate, this.probeCounter, this.config.probeInterval,
        );

      case 'custom':
        if (!this.config.customScoring) {
          throw new Error('Custom strategy requires customScoring function in RouterConfig');
        }
        return customStrategy(
          entries, request, this.healthTracker, this.costEstimator,
          this.config.customScoring,
        );

      default:
        return priorityStrategy(entries, request, this.healthTracker, this.costEstimator);
    }
  }

  /**
   * Build a human-readable reason string for why an adapter was selected.
   */
  private buildReason(
    adapter: PaymentAdapter,
    cost: CostEstimate,
    health: AdapterHealth,
    strategy: RoutingStrategy,
    request?: RouteRequest,
  ): string {
    const parts: string[] = [];

    switch (strategy) {
      case 'priority':
        parts.push('highest static priority');
        break;
      case 'lowest-cost':
        parts.push(`lowest cost ($${cost.transactionCost})`);
        break;
      case 'highest-success':
        parts.push(`highest success rate (${(health.successRate * 100).toFixed(0)}%)`);
        break;
      case 'lowest-latency':
        parts.push(`lowest latency (${health.avgLatencyMs.toFixed(0)}ms)`);
        break;
      case 'round-robin':
        parts.push('round-robin rotation');
        break;
      case 'weighted':
        parts.push('weighted random selection');
        break;
      case 'smart':
        parts.push(
          `smart scoring: cost $${cost.transactionCost}, ` +
          `${(health.successRate * 100).toFixed(0)}% success, ` +
          `${health.avgLatencyMs.toFixed(0)}ms latency`,
        );
        break;
      case 'adaptive':
        parts.push(`adaptive (${(this.config.explorationRate * 100).toFixed(0)}% exploration)`);
        break;
      case 'conditional':
        parts.push('matched routing rule');
        break;
      case 'amount-tiered':
        parts.push('amount-tier routing');
        break;
      case 'geo-aware':
        parts.push(`geo-aware routing (region: ${request?.domain ?? 'unknown'})`);
        break;
      case 'time-aware':
        parts.push(`time-aware routing (hour: ${new Date().getUTCHours()} UTC)`);
        break;
      case 'failover-only':
        parts.push('primary adapter (failover mode)');
        break;
      case 'custom':
        parts.push('custom scoring function');
        break;
    }

    return `${adapter.type} selected — ${parts.join(', ')}`;
  }
}
