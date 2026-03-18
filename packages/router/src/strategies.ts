/**
 * @module strategies
 *
 * Routing strategy implementations. Each strategy takes the set of
 * adapter entries plus health/cost data and returns an ordered list
 * of adapters (best-first).
 */

import type { PaymentAdapter } from '@openagentpay/core';
import type { AdapterEntry, RouteRequest } from './types.js';
import type { HealthTracker } from './health.js';
import type { CostEstimator } from './cost.js';

// ---------------------------------------------------------------------------
// Strategy functions
// ---------------------------------------------------------------------------

/**
 * Priority strategy — sort by static priority (lower number = higher priority).
 * This replicates the current OpenAgentPay behaviour of iterating adapters
 * in declaration order.
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

  // Map back to adapters in cost order
  const adapterMap = new Map(entries.map((e) => [e.adapter.type, e.adapter]));
  return viableTypes
    .map((type) => adapterMap.get(type))
    .filter((a): a is PaymentAdapter => a !== undefined);
}

/**
 * Highest-success strategy — sort by success rate (descending).
 * Unhealthy adapters (below minSuccessRate) are excluded.
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

/**
 * Lowest-latency strategy — sort by average latency (ascending).
 * Adapters with no data are placed at the end.
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
      // Adapters with no data go to the end (try them to gather data)
      if (a.health.totalAttempts === 0 && b.health.totalAttempts === 0) return 0;
      if (a.health.totalAttempts === 0) return 1;
      if (b.health.totalAttempts === 0) return -1;
      return a.health.avgLatencyMs - b.health.avgLatencyMs;
    })
    .map((item) => item.adapter);
}

/**
 * Round-robin strategy — distributes requests evenly across healthy adapters
 * using an external counter.
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
    // Fallback: return all adapters by priority
    return [...entries]
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
      .map((e) => e.adapter);
  }

  // Rotate the array so the "next" adapter is first
  const idx = counter.value % healthy.length;
  counter.value++;

  const rotated = [...healthy.slice(idx), ...healthy.slice(0, idx)];
  return rotated.map((e) => e.adapter);
}

/**
 * Weighted strategy — probabilistic selection based on adapter weights.
 * Higher weight = higher probability of being selected first.
 * Returns a full ordering for cascade purposes.
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

  // Build weighted pool and select without replacement
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

/**
 * Smart strategy — composite scoring that balances success rate,
 * cost, and latency.
 *
 * Score = (successRate * 0.5) + ((1 - normalizedCost) * 0.3) + ((1 - normalizedLatency) * 0.2)
 *
 * Non-viable adapters are excluded. Adapters with no health data
 * get a default score that places them in the middle.
 */
export function smartStrategy(
  entries: AdapterEntry[],
  request: RouteRequest,
  health: HealthTracker,
  cost: CostEstimator,
  minSuccessRate: number = 0.5,
): PaymentAdapter[] {
  // Gather cost estimates and health data
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

  // Filter non-viable
  const viable = scored.filter((s) => s.isViable);
  if (viable.length === 0) {
    // Fallback: return by priority
    return [...entries]
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
      .map((e) => e.adapter);
  }

  // Filter unhealthy (but keep adapters with no data)
  const candidates = viable.filter(
    (s) => s.health.totalAttempts === 0 || s.health.successRate >= minSuccessRate,
  );

  if (candidates.length === 0) {
    // All adapters are unhealthy — return viable by priority
    return viable.map((s) => s.adapter);
  }

  // Normalize cost and latency across candidates
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

  // Sort by score descending (highest score = best choice)
  withScores.sort((a, b) => b.score - a.score);

  return withScores.map((s) => s.adapter);
}
