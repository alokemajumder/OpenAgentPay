/**
 * @module health
 *
 * HealthTracker — per-adapter success/failure/latency tracking with
 * sliding time windows. Feeds the routing engine with real-time
 * performance data for intelligent adapter selection.
 */

import type { AdapterHealth } from './types.js';

// ---------------------------------------------------------------------------
// Internal entry types
// ---------------------------------------------------------------------------

interface SuccessEntry {
  type: 'success';
  timestamp: number;
  latencyMs: number;
}

interface FailureEntry {
  type: 'failure';
  timestamp: number;
  error?: string;
}

type HealthEntry = SuccessEntry | FailureEntry;

// ---------------------------------------------------------------------------
// HealthTracker
// ---------------------------------------------------------------------------

/**
 * Tracks per-adapter success rate, failure rate, and latency using
 * a sliding time window. Entries older than `windowMs` are pruned
 * on every read operation.
 */
export class HealthTracker {
  private readonly windowMs: number;
  private readonly entries = new Map<string, HealthEntry[]>();

  /**
   * @param windowMs - Sliding window duration in milliseconds. Default: 300000 (5 min).
   */
  constructor(windowMs: number = 300_000) {
    this.windowMs = windowMs;
  }

  /**
   * Record a successful payment attempt for an adapter.
   */
  recordSuccess(adapterType: string, latencyMs: number): void {
    const list = this.getOrCreateEntries(adapterType);
    list.push({
      type: 'success',
      timestamp: Date.now(),
      latencyMs,
    });
  }

  /**
   * Record a failed payment attempt for an adapter.
   */
  recordFailure(adapterType: string, error?: string): void {
    const list = this.getOrCreateEntries(adapterType);
    list.push({
      type: 'failure',
      timestamp: Date.now(),
      error,
    });
  }

  /**
   * Get computed health metrics for a single adapter.
   * Returns default healthy metrics if no data exists.
   */
  getHealth(adapterType: string): AdapterHealth {
    const entries = this.pruneAndGet(adapterType);

    if (entries.length === 0) {
      return {
        adapterType,
        successRate: 1.0, // assume healthy if no data
        avgLatencyMs: 0,
        p95LatencyMs: 0,
        totalAttempts: 0,
        recentSuccesses: 0,
        recentFailures: 0,
        isHealthy: true,
      };
    }

    const successes = entries.filter((e): e is SuccessEntry => e.type === 'success');
    const failures = entries.filter((e): e is FailureEntry => e.type === 'failure');

    const successRate = entries.length > 0 ? successes.length / entries.length : 1.0;

    // Latency stats from successful requests
    let avgLatencyMs = 0;
    let p95LatencyMs = 0;
    if (successes.length > 0) {
      const latencies = successes.map((s) => s.latencyMs).sort((a, b) => a - b);
      avgLatencyMs = latencies.reduce((sum, l) => sum + l, 0) / latencies.length;
      const p95Index = Math.max(0, Math.ceil(latencies.length * 0.95) - 1);
      p95LatencyMs = latencies[p95Index]!;
    }

    // Last failure info
    const lastFailure = failures.length > 0 ? failures[failures.length - 1]! : undefined;
    const lastSuccess = successes.length > 0 ? successes[successes.length - 1]! : undefined;

    return {
      adapterType,
      successRate,
      avgLatencyMs,
      p95LatencyMs,
      totalAttempts: entries.length,
      recentSuccesses: successes.length,
      recentFailures: failures.length,
      lastFailureError: lastFailure?.error,
      lastSuccessAt: lastSuccess ? new Date(lastSuccess.timestamp).toISOString() : undefined,
      lastFailureAt: lastFailure ? new Date(lastFailure.timestamp).toISOString() : undefined,
      isHealthy: successRate >= 0.5,
    };
  }

  /**
   * Get health metrics for all tracked adapters.
   */
  getAllHealth(): Map<string, AdapterHealth> {
    const result = new Map<string, AdapterHealth>();
    for (const adapterType of this.entries.keys()) {
      result.set(adapterType, this.getHealth(adapterType));
    }
    return result;
  }

  /**
   * Check whether an adapter meets the minimum success rate threshold.
   */
  isHealthy(adapterType: string, minSuccessRate: number = 0.5): boolean {
    const health = this.getHealth(adapterType);
    // No data means we consider it healthy (optimistic)
    if (health.totalAttempts === 0) return true;
    return health.successRate >= minSuccessRate;
  }

  /**
   * Reset tracking data. If adapterType is provided, only that adapter
   * is reset; otherwise all data is cleared.
   */
  reset(adapterType?: string): void {
    if (adapterType) {
      this.entries.delete(adapterType);
    } else {
      this.entries.clear();
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private getOrCreateEntries(adapterType: string): HealthEntry[] {
    let list = this.entries.get(adapterType);
    if (!list) {
      list = [];
      this.entries.set(adapterType, list);
    }
    return list;
  }

  private pruneAndGet(adapterType: string): HealthEntry[] {
    const list = this.entries.get(adapterType);
    if (!list) return [];

    const cutoff = Date.now() - this.windowMs;
    const pruned = list.filter((e) => e.timestamp >= cutoff);
    this.entries.set(adapterType, pruned);
    return pruned;
  }
}
