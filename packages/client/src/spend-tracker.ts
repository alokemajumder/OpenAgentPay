/**
 * @module spend-tracker
 *
 * In-memory spend tracking for agent payment governance.
 *
 * Tracks daily (rolling 24h), session (since creation), and
 * per-provider (by domain, rolling 24h) spend totals. Used by
 * the policy engine in `client.ts` to enforce budget limits.
 *
 * All amounts use string-based decimal arithmetic to avoid
 * floating-point precision issues with financial calculations.
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single spend entry with its timestamp for rolling-window calculations.
 */
interface SpendEntry {
  /** The amount spent, as a decimal string. */
  amount: string;

  /** Timestamp (ms since epoch) when the spend was recorded. */
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Rolling window duration: 24 hours in milliseconds. */
const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sum all entries within the rolling window.
 *
 * Entries older than `now - ROLLING_WINDOW_MS` are excluded from the
 * total but left in the array (pruned lazily during `recordSpend`).
 */
function sumWithinWindow(entries: SpendEntry[], now: number): string {
  const cutoff = now - ROLLING_WINDOW_MS;
  let total = 0;
  for (const entry of entries) {
    if (entry.timestamp >= cutoff) {
      total += parseFloat(entry.amount);
    }
  }
  return total.toFixed(10).replace(/\.?0+$/, "");
}

/**
 * Prune entries older than the rolling window.
 * Returns a new array containing only entries within the window.
 */
function pruneEntries(entries: SpendEntry[], now: number): SpendEntry[] {
  const cutoff = now - ROLLING_WINDOW_MS;
  return entries.filter((e) => e.timestamp >= cutoff);
}

// ---------------------------------------------------------------------------
// SpendTracker
// ---------------------------------------------------------------------------

/**
 * In-memory spend tracker for enforcing agent budget policies.
 *
 * Maintains three running totals:
 * - **Daily**: all spend in a rolling 24-hour window
 * - **Session**: all spend since the tracker was created
 * - **Per-provider**: spend per domain in a rolling 24-hour window
 *
 * Thread-safe for single-threaded JavaScript runtimes. Not designed
 * for multi-process or distributed use; each agent instance should
 * have its own tracker.
 *
 * @example
 * ```typescript
 * const tracker = new SpendTracker();
 *
 * tracker.recordSpend('api.example.com', '0.01');
 * tracker.recordSpend('api.example.com', '0.02');
 *
 * tracker.getDailyTotal();                    // "0.03"
 * tracker.getSessionTotal();                  // "0.03"
 * tracker.getProviderTotal('api.example.com'); // "0.03"
 * ```
 */
export class SpendTracker {
  /** All daily spend entries (pruned lazily on `recordSpend`). */
  private dailyEntries: SpendEntry[] = [];

  /** Cumulative session total as a raw number (converted to string on read). */
  private sessionTotal = 0;

  /** Per-provider spend entries, keyed by domain. */
  private providerEntries = new Map<string, SpendEntry[]>();

  /**
   * Record a spend event.
   *
   * Updates all three tracking dimensions (daily, session, per-provider)
   * and lazily prunes expired entries from the rolling windows.
   *
   * @param domain - The provider domain (e.g. `"api.example.com"`).
   * @param amount - The amount spent as a decimal string (e.g. `"0.01"`).
   */
  recordSpend(domain: string, amount: string): void {
    const now = Date.now();
    const entry: SpendEntry = { amount, timestamp: now };

    // --- Daily ---
    this.dailyEntries = pruneEntries(this.dailyEntries, now);
    this.dailyEntries.push(entry);

    // --- Session ---
    this.sessionTotal += parseFloat(amount);

    // --- Per-provider ---
    let providerList = this.providerEntries.get(domain);
    if (!providerList) {
      providerList = [];
      this.providerEntries.set(domain, providerList);
    }
    const pruned = pruneEntries(providerList, now);
    pruned.push(entry);
    this.providerEntries.set(domain, pruned);
  }

  /**
   * Get the total spend in the current rolling 24-hour window.
   *
   * @returns The daily total as a decimal string.
   */
  getDailyTotal(): string {
    return sumWithinWindow(this.dailyEntries, Date.now());
  }

  /**
   * Get the total spend since the tracker was created.
   *
   * @returns The session total as a decimal string.
   */
  getSessionTotal(): string {
    const s = this.sessionTotal.toFixed(10).replace(/\.?0+$/, "");
    return s || "0";
  }

  /**
   * Get the total spend for a specific provider in the current
   * rolling 24-hour window.
   *
   * @param domain - The provider domain to look up.
   * @returns The provider total as a decimal string, or `"0"` if no spend recorded.
   */
  getProviderTotal(domain: string): string {
    const entries = this.providerEntries.get(domain);
    if (!entries || entries.length === 0) {
      return "0";
    }
    return sumWithinWindow(entries, Date.now());
  }

  /**
   * Reset all tracked spend data.
   *
   * Useful for testing or when the agent starts a new logical session.
   */
  reset(): void {
    this.dailyEntries = [];
    this.sessionTotal = 0;
    this.providerEntries.clear();
  }
}
