/**
 * @module spend-tracker
 *
 * In-memory rolling-window spend tracking for the policy engine.
 *
 * Tracks three categories of spend:
 * - **Daily** — 24-hour rolling window across all providers
 * - **Session** — cumulative since the tracker was created (or last reset)
 * - **Per-provider** — 24-hour rolling window per unique domain
 *
 * All amounts are handled as decimal strings to avoid floating-point errors.
 */

/** A single recorded spend event with a timestamp. */
interface SpendEntry {
  /** Amount as a decimal string (e.g., `"0.50"`). */
  amount: string;
  /** Unix timestamp in milliseconds when the spend was recorded. */
  timestamp: number;
}

/** Duration of the rolling window in milliseconds (24 hours). */
const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Sums an array of decimal string amounts.
 *
 * Uses parseFloat internally — acceptable precision for spend tracking
 * of amounts typically in the range $0.001 to $1000.
 *
 * @param amounts - Array of decimal strings
 * @returns Sum as a decimal string with 2 decimal places
 */
function sumAmounts(amounts: string[]): string {
  let total = 0;
  for (const a of amounts) {
    total += parseFloat(a);
  }
  // Use toFixed(6) to avoid floating-point display artifacts
  // then strip trailing zeros but keep at least 2 decimal places
  return formatDecimal(total);
}

/**
 * Format a number as a clean decimal string.
 * Preserves meaningful precision, minimum 2 decimal places.
 */
function formatDecimal(n: number): string {
  // Use enough precision to avoid floating-point display issues
  const raw = n.toFixed(6);
  // Remove trailing zeros but keep at least 2 decimal places
  const parts = raw.split(".");
  if (parts.length === 1) {
    return `${parts[0]}.00`;
  }
  let decimals = parts[1]!;
  // Remove trailing zeros beyond 2 digits
  while (decimals.length > 2 && decimals.endsWith("0")) {
    decimals = decimals.slice(0, -1);
  }
  return `${parts[0]}.${decimals}`;
}

/**
 * Filters entries to only those within the rolling window.
 *
 * @param entries - Array of spend entries
 * @param now - Current time in milliseconds
 * @returns Entries within the last 24 hours
 */
function filterToWindow(entries: SpendEntry[], now: number): SpendEntry[] {
  const cutoff = now - ROLLING_WINDOW_MS;
  return entries.filter((e) => e.timestamp >= cutoff);
}

/**
 * In-memory spend tracker for the policy engine.
 *
 * Maintains rolling-window totals for daily and per-provider spending,
 * plus a cumulative session total. Used by the PolicyEngine to enforce
 * budget limits before approving payments.
 *
 * @example
 * ```typescript
 * const tracker = new SpendTracker();
 * tracker.record('api.example.com', '0.50');
 * tracker.record('api.example.com', '0.25');
 * tracker.getDailyTotal();                      // '0.75'
 * tracker.getProviderTotal('api.example.com');   // '0.75'
 * tracker.getSessionTotal();                     // '0.75'
 * ```
 */
export class SpendTracker {
  /** All spend entries (pruned lazily on read). */
  private entries: SpendEntry[] = [];

  /** Per-provider spend entries keyed by domain. */
  private providerEntries: Map<string, SpendEntry[]> = new Map();

  /** Cumulative session total (never expires). */
  private sessionTotal = 0;

  /**
   * Record a completed payment.
   *
   * Call this after a payment has been successfully executed,
   * NOT before. The policy engine calls `evaluate()` first,
   * and only calls `record()` after the payment settles.
   *
   * @param domain - The provider domain that received the payment
   * @param amount - The amount paid as a decimal string (e.g., `"0.50"`)
   */
  record(domain: string, amount: string): void {
    const timestamp = Date.now();
    const entry: SpendEntry = { amount, timestamp };

    this.entries.push(entry);
    this.sessionTotal += parseFloat(amount);

    const key = domain.toLowerCase();
    const providerList = this.providerEntries.get(key);
    if (providerList) {
      providerList.push(entry);
    } else {
      this.providerEntries.set(key, [entry]);
    }
  }

  /**
   * Get the total amount spent in the last 24 hours across all providers.
   *
   * @returns Total daily spend as a decimal string (e.g., `"4.30"`)
   */
  getDailyTotal(): string {
    const now = Date.now();
    this.entries = filterToWindow(this.entries, now);
    return sumAmounts(this.entries.map((e) => e.amount));
  }

  /**
   * Get the cumulative amount spent since the tracker was created or last reset.
   *
   * @returns Session total as a decimal string (e.g., `"12.50"`)
   */
  getSessionTotal(): string {
    return formatDecimal(this.sessionTotal);
  }

  /**
   * Get the total amount spent on a specific provider in the last 24 hours.
   *
   * @param domain - The provider domain to query
   * @returns Provider daily spend as a decimal string (e.g., `"2.00"`)
   */
  getProviderTotal(domain: string): string {
    const key = domain.toLowerCase();
    const providerList = this.providerEntries.get(key);
    if (!providerList) {
      return "0.00";
    }
    const now = Date.now();
    const filtered = filterToWindow(providerList, now);
    this.providerEntries.set(key, filtered);
    return sumAmounts(filtered.map((e) => e.amount));
  }

  /**
   * Reset all spend tracking state.
   *
   * Useful for testing or when starting a new agent session.
   */
  reset(): void {
    this.entries = [];
    this.providerEntries.clear();
    this.sessionTotal = 0;
  }
}
