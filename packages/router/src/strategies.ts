/**
 * @module strategies
 *
 * Routing strategy implementations for the OpenAgentPay Smart Router.
 *
 * 14 strategies ranging from simple static ordering to ML-inspired
 * adaptive algorithms. Each strategy takes adapter entries plus
 * health/cost data and returns an ordered list of adapters (best-first).
 *
 * Strategies:
 *  - priority          — static priority order
 *  - lowest-cost       — cheapest viable adapter
 *  - highest-success   — best recent success rate
 *  - lowest-latency    — fastest recent response time
 *  - round-robin       — even distribution
 *  - weighted          — probabilistic by weight
 *  - smart             — composite score (success + cost + latency)
 *  - adaptive          — multi-armed bandit with exploration/exploitation
 *  - conditional       — rule-based if/else routing (like Juspay)
 *  - amount-tiered     — different strategy per amount range
 *  - geo-aware         — region-based routing preferences
 *  - time-aware        — time-of-day performance optimization
 *  - failover-only     — use primary until it fails, then switch
 *  - custom            — user-defined scoring function
 */

import type { PaymentAdapter } from '@openagentpay/core';
import type { AdapterEntry, RouteRequest } from './types.js';
import type { HealthTracker } from './health.js';
import type { CostEstimator } from './cost.js';

// ---------------------------------------------------------------------------
// Strategy 1: Priority (static order)
// ---------------------------------------------------------------------------

/**
 * Priority strategy — sort by static priority (lower number = higher priority).
 * Replicates the original behavior of iterating adapters in declaration order.
 */
export function priorityStrategy(
  entries: AdapterEntry[],
  _request: RouteRequest,
  _health: HealthTracker,
  _cost: CostEstimator,
): PaymentAdapter[] {
  return [...entries]
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
    .map((e) => e.adapter);
}

// ---------------------------------------------------------------------------
// Strategy 2: Lowest Cost
// ---------------------------------------------------------------------------

/**
 * Lowest-cost strategy — sort by estimated transaction cost, cheapest first.
 * Non-viable adapters (below minimum, wrong currency) are excluded.
 */
export function lowestCostStrategy(
  entries: AdapterEntry[],
  request: RouteRequest,
  _health: HealthTracker,
  cost: CostEstimator,
): PaymentAdapter[] {
  const estimates = cost.rankByCost(entries, request.amount, request.currency);
  const viableTypes = estimates
    .filter((e) => e.isViable)
    .map((e) => e.adapterType);

  const adapterMap = new Map(entries.map((e) => [e.adapter.type, e.adapter]));
  return viableTypes
    .map((type) => adapterMap.get(type))
    .filter((a): a is PaymentAdapter => a !== undefined);
}

// ---------------------------------------------------------------------------
// Strategy 3: Highest Success Rate
// ---------------------------------------------------------------------------

/**
 * Highest-success strategy — sort by success rate (descending).
 * Unhealthy adapters (below minSuccessRate) are excluded.
 * Adapters with no data are kept (optimistic — they need to be tried).
 */
export function highestSuccessStrategy(
  entries: AdapterEntry[],
  _request: RouteRequest,
  health: HealthTracker,
  _cost: CostEstimator,
  minSuccessRate: number = 0.5,
): PaymentAdapter[] {
  return entries
    .map((e) => ({
      adapter: e.adapter,
      health: health.getHealth(e.adapter.type),
    }))
    .filter((item) => item.health.totalAttempts === 0 || item.health.successRate >= minSuccessRate)
    .sort((a, b) => b.health.successRate - a.health.successRate)
    .map((item) => item.adapter);
}

// ---------------------------------------------------------------------------
// Strategy 4: Lowest Latency
// ---------------------------------------------------------------------------

/**
 * Lowest-latency strategy — sort by average latency (ascending).
 * Adapters with no data are placed at the end to be explored.
 */
export function lowestLatencyStrategy(
  entries: AdapterEntry[],
  _request: RouteRequest,
  health: HealthTracker,
  _cost: CostEstimator,
): PaymentAdapter[] {
  return entries
    .map((e) => ({
      adapter: e.adapter,
      health: health.getHealth(e.adapter.type),
    }))
    .sort((a, b) => {
      if (a.health.totalAttempts === 0 && b.health.totalAttempts === 0) return 0;
      if (a.health.totalAttempts === 0) return 1;
      if (b.health.totalAttempts === 0) return -1;
      return a.health.avgLatencyMs - b.health.avgLatencyMs;
    })
    .map((item) => item.adapter);
}

// ---------------------------------------------------------------------------
// Strategy 5: Round Robin
// ---------------------------------------------------------------------------

/**
 * Round-robin strategy — distributes requests evenly across healthy adapters
 * using a persistent counter.
 */
export function roundRobinStrategy(
  entries: AdapterEntry[],
  _request: RouteRequest,
  health: HealthTracker,
  _cost: CostEstimator,
  counter: { value: number },
  minSuccessRate: number = 0.5,
): PaymentAdapter[] {
  const healthy = entries.filter(
    (e) => health.isHealthy(e.adapter.type, minSuccessRate),
  );

  if (healthy.length === 0) {
    return [...entries]
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
      .map((e) => e.adapter);
  }

  const idx = counter.value % healthy.length;
  counter.value++;

  const rotated = [...healthy.slice(idx), ...healthy.slice(0, idx)];
  return rotated.map((e) => e.adapter);
}

// ---------------------------------------------------------------------------
// Strategy 6: Weighted Random
// ---------------------------------------------------------------------------

/**
 * Weighted strategy — probabilistic selection based on adapter weights.
 * Higher weight = higher probability of being selected first.
 * Returns a full ordering (without replacement) for cascade purposes.
 */
export function weightedStrategy(
  entries: AdapterEntry[],
  _request: RouteRequest,
  health: HealthTracker,
  _cost: CostEstimator,
  minSuccessRate: number = 0.5,
): PaymentAdapter[] {
  const healthy = entries.filter(
    (e) => health.isHealthy(e.adapter.type, minSuccessRate),
  );

  if (healthy.length === 0) {
    return [...entries]
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
      .map((e) => e.adapter);
  }

  const remaining = healthy.map((e) => ({
    entry: e,
    weight: e.weight ?? 50,
  }));

  const result: PaymentAdapter[] = [];

  while (remaining.length > 0) {
    const totalWeight = remaining.reduce((sum, r) => sum + r.weight, 0);
    let random = Math.random() * totalWeight;

    let selectedIdx = 0;
    for (let i = 0; i < remaining.length; i++) {
      random -= remaining[i]!.weight;
      if (random <= 0) {
        selectedIdx = i;
        break;
      }
    }

    result.push(remaining[selectedIdx]!.entry.adapter);
    remaining.splice(selectedIdx, 1);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Strategy 7: Smart (Composite Score)
// ---------------------------------------------------------------------------

/**
 * Smart strategy — composite scoring that balances success rate,
 * cost, and latency.
 *
 * Score = (successRate * 0.5) + ((1 - normalizedCost) * 0.3) + ((1 - normalizedLatency) * 0.2)
 *
 * Non-viable adapters are excluded. Adapters with no health data
 * get an optimistic default score.
 */
export function smartStrategy(
  entries: AdapterEntry[],
  request: RouteRequest,
  health: HealthTracker,
  cost: CostEstimator,
  minSuccessRate: number = 0.5,
): PaymentAdapter[] {
  const scored = entries.map((entry) => {
    const costEstimate = cost.estimateCost(entry, request.amount, request.currency);
    const healthData = health.getHealth(entry.adapter.type);
    return {
      adapter: entry.adapter,
      costEstimate,
      health: healthData,
      costValue: parseFloat(costEstimate.transactionCost),
      isViable: costEstimate.isViable,
    };
  });

  const viable = scored.filter((s) => s.isViable);
  if (viable.length === 0) {
    return [...entries]
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
      .map((e) => e.adapter);
  }

  const candidates = viable.filter(
    (s) => s.health.totalAttempts === 0 || s.health.successRate >= minSuccessRate,
  );

  if (candidates.length === 0) {
    return viable.map((s) => s.adapter);
  }

  const maxCost = Math.max(...candidates.map((c) => c.costValue), 0.000001);
  const maxLatency = Math.max(
    ...candidates.map((c) => c.health.avgLatencyMs),
    1,
  );

  const withScores = candidates.map((c) => {
    const successRate = c.health.totalAttempts === 0 ? 1.0 : c.health.successRate;
    const normalizedCost = maxCost > 0 ? c.costValue / maxCost : 0;
    const normalizedLatency = maxLatency > 0 ? c.health.avgLatencyMs / maxLatency : 0;

    const score =
      successRate * 0.5 +
      (1 - normalizedCost) * 0.3 +
      (1 - normalizedLatency) * 0.2;

    return { ...c, score };
  });

  withScores.sort((a, b) => b.score - a.score);
  return withScores.map((s) => s.adapter);
}

// ---------------------------------------------------------------------------
// Strategy 8: Adaptive (Multi-Armed Bandit)
// ---------------------------------------------------------------------------

/**
 * Adaptive strategy — exploration/exploitation balance inspired by
 * Juspay's dynamic gateway ordering.
 *
 * Allocates `explorationRate` (default 10%) of traffic to random
 * exploration of all viable adapters. Remaining traffic goes to
 * the best performer (exploitation via smart scoring).
 *
 * This ensures underperforming adapters get periodic traffic to
 * detect recovery, while the majority of traffic goes to proven winners.
 *
 * Uses epsilon-greedy approach: with probability `explorationRate`,
 * pick a random adapter; otherwise, use the smart strategy.
 */
export function adaptiveStrategy(
  entries: AdapterEntry[],
  request: RouteRequest,
  health: HealthTracker,
  cost: CostEstimator,
  minSuccessRate: number = 0.5,
  explorationRate: number = 0.1,
): PaymentAdapter[] {
  const viable = entries.filter((entry) => {
    const estimate = cost.estimateCost(entry, request.amount, request.currency);
    return estimate.isViable;
  });

  if (viable.length === 0) {
    return [...entries]
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
      .map((e) => e.adapter);
  }

  // Epsilon-greedy: explore with probability `explorationRate`
  if (Math.random() < explorationRate) {
    // Exploration: shuffle viable adapters randomly
    const shuffled = [...viable];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    return shuffled.map((e) => e.adapter);
  }

  // Exploitation: use smart strategy
  return smartStrategy(entries, request, health, cost, minSuccessRate);
}

// ---------------------------------------------------------------------------
// Strategy 9: Conditional (Rule-Based)
// ---------------------------------------------------------------------------

/**
 * A routing rule that maps a condition to a preferred adapter ordering.
 */
export interface RoutingRule {
  /** Human-readable name for this rule. */
  name: string;
  /** Condition function — receives the route request and returns true if this rule applies. */
  condition: (request: RouteRequest) => boolean;
  /** Ordered list of adapter types to prefer when this rule matches. */
  preferredAdapters: string[];
  /** Fallback strategy if none of the preferred adapters are available. */
  fallbackStrategy?: 'priority' | 'lowest-cost' | 'smart';
}

/**
 * Conditional strategy — rule-based if/else routing like Juspay's
 * merchant-controlled routing engine.
 *
 * Evaluates rules in order. First matching rule determines the
 * adapter ordering. If no rule matches, falls back to priority.
 *
 * @example
 * ```typescript
 * const rules: RoutingRule[] = [
 *   {
 *     name: 'micro-payments',
 *     condition: (req) => parseFloat(req.amount) < 0.50,
 *     preferredAdapters: ['mpp', 'x402', 'credits'],
 *   },
 *   {
 *     name: 'india-region',
 *     condition: (req) => req.region === 'IN',
 *     preferredAdapters: ['upi', 'credits', 'mpp'],
 *   },
 *   {
 *     name: 'fiat-preferred',
 *     condition: (req) => ['USD', 'EUR', 'GBP'].includes(req.currency),
 *     preferredAdapters: ['stripe', 'paypal', 'credits'],
 *     fallbackStrategy: 'lowest-cost',
 *   },
 * ];
 * ```
 */
export function conditionalStrategy(
  entries: AdapterEntry[],
  request: RouteRequest,
  health: HealthTracker,
  cost: CostEstimator,
  rules: RoutingRule[],
  minSuccessRate: number = 0.5,
): PaymentAdapter[] {
  const adapterMap = new Map(entries.map((e) => [e.adapter.type, e]));

  // Find first matching rule
  for (const rule of rules) {
    if (!rule.condition(request)) continue;

    // Rule matches — build ordering from preferred adapters
    const preferred: PaymentAdapter[] = [];
    for (const type of rule.preferredAdapters) {
      const entry = adapterMap.get(type);
      if (entry && entry.enabled !== false && health.isHealthy(type, minSuccessRate)) {
        const estimate = cost.estimateCost(entry, request.amount, request.currency);
        if (estimate.isViable) {
          preferred.push(entry.adapter);
        }
      }
    }

    if (preferred.length > 0) {
      // Add remaining adapters as fallbacks
      const preferredTypes = new Set(preferred.map((a) => a.type));
      const remaining = entries
        .filter((e) => !preferredTypes.has(e.adapter.type) && e.enabled !== false)
        .map((e) => e.adapter);
      return [...preferred, ...remaining];
    }

    // No preferred adapters available — use fallback strategy
    const fallback = rule.fallbackStrategy ?? 'priority';
    switch (fallback) {
      case 'lowest-cost':
        return lowestCostStrategy(entries, request, health, cost);
      case 'smart':
        return smartStrategy(entries, request, health, cost, minSuccessRate);
      default:
        return priorityStrategy(entries, request, health, cost);
    }
  }

  // No rule matched — fall back to priority
  return priorityStrategy(entries, request, health, cost);
}

// ---------------------------------------------------------------------------
// Strategy 10: Amount-Tiered
// ---------------------------------------------------------------------------

/**
 * Amount tier configuration.
 */
export interface AmountTier {
  /** Human-readable tier name. */
  name: string;
  /** Maximum amount for this tier (inclusive). Use Infinity for the highest tier. */
  maxAmount: number;
  /** Strategy to use for this tier. */
  strategy: 'priority' | 'lowest-cost' | 'highest-success' | 'lowest-latency' | 'smart';
  /** Optional: preferred adapter types for this tier. */
  preferredAdapters?: string[];
}

/**
 * Amount-tiered strategy — applies different routing logic based on
 * transaction amount.
 *
 * Micropayments ($0.001-$0.50) need different routing than medium
 * ($0.50-$10) or large ($10+) transactions because different adapters
 * have different fee structures and minimums.
 *
 * @example
 * ```typescript
 * const tiers: AmountTier[] = [
 *   { name: 'micro', maxAmount: 0.50, strategy: 'lowest-cost', preferredAdapters: ['mpp', 'x402', 'credits'] },
 *   { name: 'medium', maxAmount: 10, strategy: 'smart' },
 *   { name: 'large', maxAmount: Infinity, strategy: 'highest-success' },
 * ];
 * ```
 */
export function amountTieredStrategy(
  entries: AdapterEntry[],
  request: RouteRequest,
  health: HealthTracker,
  cost: CostEstimator,
  tiers: AmountTier[],
  minSuccessRate: number = 0.5,
): PaymentAdapter[] {
  const amount = parseFloat(request.amount);

  // Sort tiers by maxAmount ascending, find the first tier that contains this amount
  const sortedTiers = [...tiers].sort((a, b) => a.maxAmount - b.maxAmount);
  const tier = sortedTiers.find((t) => amount <= t.maxAmount);

  if (!tier) {
    // No tier matches — use smart as default
    return smartStrategy(entries, request, health, cost, minSuccessRate);
  }

  // If tier has preferred adapters, filter and reorder
  let filtered = entries;
  if (tier.preferredAdapters && tier.preferredAdapters.length > 0) {
    const preferredSet = new Set(tier.preferredAdapters);
    const preferred = entries.filter((e) => preferredSet.has(e.adapter.type));
    const rest = entries.filter((e) => !preferredSet.has(e.adapter.type));
    filtered = [...preferred, ...rest];
  }

  // Apply the tier's strategy
  switch (tier.strategy) {
    case 'lowest-cost':
      return lowestCostStrategy(filtered, request, health, cost);
    case 'highest-success':
      return highestSuccessStrategy(filtered, request, health, cost, minSuccessRate);
    case 'lowest-latency':
      return lowestLatencyStrategy(filtered, request, health, cost);
    case 'smart':
      return smartStrategy(filtered, request, health, cost, minSuccessRate);
    case 'priority':
    default:
      return priorityStrategy(filtered, request, health, cost);
  }
}

// ---------------------------------------------------------------------------
// Strategy 11: Geo-Aware
// ---------------------------------------------------------------------------

/**
 * Region preference configuration.
 */
export interface RegionPreference {
  /** Region/country code (e.g., 'US', 'IN', 'EU'). */
  region: string;
  /** Preferred adapter types for this region. */
  preferredAdapters: string[];
  /** Fallback strategy if preferred adapters are unavailable. */
  fallbackStrategy?: 'priority' | 'lowest-cost' | 'smart';
}

/**
 * Geo-aware strategy — routes based on the agent or provider's
 * geographic region.
 *
 * Different payment rails work better in different regions:
 * - India: UPI (near-zero fees, 300M+ users)
 * - US/EU: Stripe (best developer tools) or MPP
 * - Global crypto: x402, MPP/Tempo
 *
 * @example
 * ```typescript
 * const regions: RegionPreference[] = [
 *   { region: 'IN', preferredAdapters: ['upi', 'credits', 'mpp'] },
 *   { region: 'US', preferredAdapters: ['mpp', 'stripe', 'x402'] },
 *   { region: 'EU', preferredAdapters: ['mpp', 'stripe', 'paypal'] },
 * ];
 * ```
 */
export function geoAwareStrategy(
  entries: AdapterEntry[],
  request: RouteRequest,
  health: HealthTracker,
  cost: CostEstimator,
  regions: RegionPreference[],
  minSuccessRate: number = 0.5,
): PaymentAdapter[] {
  if (!request.region) {
    // No region info — fall back to smart
    return smartStrategy(entries, request, health, cost, minSuccessRate);
  }

  const upperRegion = request.region.toUpperCase();
  const regionPref = regions.find((r) => r.region.toUpperCase() === upperRegion);

  if (!regionPref) {
    return smartStrategy(entries, request, health, cost, minSuccessRate);
  }

  // Build preferred ordering
  const adapterMap = new Map(entries.map((e) => [e.adapter.type, e]));
  const preferred: PaymentAdapter[] = [];

  for (const type of regionPref.preferredAdapters) {
    const entry = adapterMap.get(type);
    if (entry && entry.enabled !== false && health.isHealthy(type, minSuccessRate)) {
      const estimate = cost.estimateCost(entry, request.amount, request.currency);
      if (estimate.isViable) {
        preferred.push(entry.adapter);
      }
    }
  }

  if (preferred.length > 0) {
    const preferredTypes = new Set(preferred.map((a) => a.type));
    const remaining = entries
      .filter((e) => !preferredTypes.has(e.adapter.type) && e.enabled !== false)
      .map((e) => e.adapter);
    return [...preferred, ...remaining];
  }

  // Fallback
  const fallback = regionPref.fallbackStrategy ?? 'smart';
  switch (fallback) {
    case 'lowest-cost':
      return lowestCostStrategy(entries, request, health, cost);
    case 'priority':
      return priorityStrategy(entries, request, health, cost);
    default:
      return smartStrategy(entries, request, health, cost, minSuccessRate);
  }
}

// ---------------------------------------------------------------------------
// Strategy 12: Time-Aware
// ---------------------------------------------------------------------------

/**
 * Time window configuration.
 */
export interface TimeWindow {
  /** Start hour (0-23, UTC). */
  startHour: number;
  /** End hour (0-23, UTC). End < start wraps around midnight. */
  endHour: number;
  /** Preferred adapter types during this window. */
  preferredAdapters: string[];
  /** Strategy to use during this window. */
  strategy?: 'priority' | 'lowest-cost' | 'highest-success' | 'smart';
}

/**
 * Time-aware strategy — optimizes routing based on time of day.
 *
 * Different adapters have different performance characteristics at
 * different times. Card processors may have higher decline rates
 * during batch settlement windows. Crypto rails may be faster
 * during low-traffic hours.
 *
 * @example
 * ```typescript
 * const windows: TimeWindow[] = [
 *   { startHour: 0, endHour: 6, preferredAdapters: ['mpp', 'x402'], strategy: 'lowest-cost' },
 *   { startHour: 6, endHour: 18, preferredAdapters: ['stripe', 'mpp'], strategy: 'smart' },
 *   { startHour: 18, endHour: 0, preferredAdapters: ['mpp', 'x402', 'credits'], strategy: 'highest-success' },
 * ];
 * ```
 */
export function timeAwareStrategy(
  entries: AdapterEntry[],
  request: RouteRequest,
  health: HealthTracker,
  cost: CostEstimator,
  windows: TimeWindow[],
  minSuccessRate: number = 0.5,
): PaymentAdapter[] {
  const now = new Date();
  const currentHour = now.getUTCHours();

  // Find matching time window
  const window = windows.find((w) => {
    if (w.startHour <= w.endHour) {
      // Normal window (e.g., 6-18)
      return currentHour >= w.startHour && currentHour < w.endHour;
    }
    // Wraparound window (e.g., 18-6 = 18-24 + 0-6)
    return currentHour >= w.startHour || currentHour < w.endHour;
  });

  if (!window) {
    return smartStrategy(entries, request, health, cost, minSuccessRate);
  }

  // Apply preferred adapters
  const adapterMap = new Map(entries.map((e) => [e.adapter.type, e]));
  const preferred: PaymentAdapter[] = [];

  for (const type of window.preferredAdapters) {
    const entry = adapterMap.get(type);
    if (entry && entry.enabled !== false) {
      preferred.push(entry.adapter);
    }
  }

  const preferredTypes = new Set(preferred.map((a) => a.type));
  const remaining = entries
    .filter((e) => !preferredTypes.has(e.adapter.type) && e.enabled !== false)
    .map((e) => e.adapter);
  const reordered = [...preferred, ...remaining];

  // Wrap as entries for sub-strategy
  const reorderedEntries = reordered
    .map((a) => entries.find((e) => e.adapter.type === a.type))
    .filter((e): e is AdapterEntry => e !== undefined);

  // Apply the window's strategy
  const strategy = window.strategy ?? 'smart';
  switch (strategy) {
    case 'lowest-cost':
      return lowestCostStrategy(reorderedEntries, request, health, cost);
    case 'highest-success':
      return highestSuccessStrategy(reorderedEntries, request, health, cost, minSuccessRate);
    case 'priority':
      return priorityStrategy(reorderedEntries, request, health, cost);
    default:
      return smartStrategy(reorderedEntries, request, health, cost, minSuccessRate);
  }
}

// ---------------------------------------------------------------------------
// Strategy 13: Failover-Only
// ---------------------------------------------------------------------------

/**
 * Failover-only strategy — uses the primary adapter exclusively until
 * it becomes unhealthy, then switches to the next in priority order.
 *
 * Unlike cascade (which retries per-request), failover-only is a
 * sustained switch — once the primary goes down, ALL traffic routes
 * to the secondary until the primary recovers.
 *
 * Includes a recovery probe: periodically sends 1 request to the
 * failed primary to detect recovery (controlled by `probeInterval`).
 */
export function failoverOnlyStrategy(
  entries: AdapterEntry[],
  _request: RouteRequest,
  health: HealthTracker,
  _cost: CostEstimator,
  minSuccessRate: number = 0.5,
  probeCounter: { value: number } = { value: 0 },
  probeInterval: number = 20,
): PaymentAdapter[] {
  const sorted = [...entries].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

  // Find the highest-priority healthy adapter
  const primaryHealthy = sorted.find((e) =>
    health.isHealthy(e.adapter.type, minSuccessRate),
  );

  if (primaryHealthy) {
    // Primary is healthy — use it, but keep others as failover
    const rest = sorted
      .filter((e) => e.adapter.type !== primaryHealthy.adapter.type)
      .map((e) => e.adapter);
    return [primaryHealthy.adapter, ...rest];
  }

  // All adapters are unhealthy — use probe logic
  probeCounter.value++;

  if (probeCounter.value % probeInterval === 0) {
    // Probe: put the highest-priority adapter first to test recovery
    return sorted.map((e) => e.adapter);
  }

  // Otherwise, try all in priority order (hope for the best)
  return sorted.map((e) => e.adapter);
}

// ---------------------------------------------------------------------------
// Strategy 14: Custom Scoring
// ---------------------------------------------------------------------------

/**
 * Custom scoring function type.
 * Receives adapter entry, health data, cost estimate, and request.
 * Returns a numeric score (higher = better).
 */
export type CustomScoringFn = (
  entry: AdapterEntry,
  health: import('./types.js').AdapterHealth,
  cost: import('./types.js').CostEstimate,
  request: RouteRequest,
) => number;

/**
 * Custom strategy — user-defined scoring function for full control.
 *
 * The scoring function receives all available data about each adapter
 * and returns a numeric score. Adapters are sorted by score (highest first).
 *
 * @example
 * ```typescript
 * const myScoring: CustomScoringFn = (entry, health, cost, request) => {
 *   // Heavily penalize slow adapters
 *   const latencyPenalty = health.avgLatencyMs > 500 ? 0.5 : 1.0;
 *   // Reward cheap adapters exponentially
 *   const costBonus = 1 / (1 + parseFloat(cost.transactionCost));
 *   // Base score from success rate
 *   return health.successRate * costBonus * latencyPenalty;
 * };
 *
 * router.select(request, 'custom');
 * ```
 */
export function customStrategy(
  entries: AdapterEntry[],
  request: RouteRequest,
  health: HealthTracker,
  cost: CostEstimator,
  scoringFn: CustomScoringFn,
): PaymentAdapter[] {
  const scored = entries
    .map((entry) => {
      const h = health.getHealth(entry.adapter.type);
      const c = cost.estimateCost(entry, request.amount, request.currency);
      const score = scoringFn(entry, h, c, request);
      return { adapter: entry.adapter, score, isViable: c.isViable };
    })
    .filter((s) => s.isViable);

  if (scored.length === 0) {
    return [...entries]
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
      .map((e) => e.adapter);
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.adapter);
}
