/**
 * @module cost
 *
 * CostEstimator — estimates the total fee for using each adapter
 * on a given transaction amount, and ranks adapters by cost.
 */

import type { AdapterEntry, CostEstimate } from './types.js';

// ---------------------------------------------------------------------------
// CostEstimator
// ---------------------------------------------------------------------------

/**
 * Estimates per-adapter transaction costs and ranks adapters by
 * cost-effectiveness for a given amount and currency.
 */
export class CostEstimator {
  /**
   * Estimate the cost of using a single adapter for a transaction.
   *
   * Cost formula: `fee = costPerTransaction + (amount * costPercentage / 100)`
   */
  estimateCost(entry: AdapterEntry, amount: string, currency: string): CostEstimate {
    const adapterType = entry.adapter.type;
    const txAmount = parseFloat(amount);

    // Check currency support
    if (entry.currencies && entry.currencies.length > 0) {
      const upperCurrency = currency.toUpperCase();
      const supported = entry.currencies.some((c) => c.toUpperCase() === upperCurrency);
      if (!supported) {
        return {
          adapterType,
          transactionCost: '0',
          effectiveRate: '0',
          isViable: false,
          reason: `Currency ${currency} not supported (supports: ${entry.currencies.join(', ')})`,
        };
      }
    }

    // Check minimum amount
    if (entry.minimumAmount) {
      const min = parseFloat(entry.minimumAmount);
      if (txAmount < min) {
        return {
          adapterType,
          transactionCost: '0',
          effectiveRate: '0',
          isViable: false,
          reason: `Below minimum $${entry.minimumAmount}`,
        };
      }
    }

    // Check maximum amount
    if (entry.maximumAmount) {
      const max = parseFloat(entry.maximumAmount);
      if (txAmount > max) {
        return {
          adapterType,
          transactionCost: '0',
          effectiveRate: '0',
          isViable: false,
          reason: `Above maximum $${entry.maximumAmount}`,
        };
      }
    }

    // Calculate fee
    const fixedCost = entry.costPerTransaction ? parseFloat(entry.costPerTransaction) : 0;
    const percentageCost = entry.costPercentage ? (txAmount * entry.costPercentage) / 100 : 0;
    const totalCost = fixedCost + percentageCost;

    // Effective rate as percentage of the transaction amount
    const effectiveRate = txAmount > 0 ? (totalCost / txAmount) * 100 : 0;

    return {
      adapterType,
      transactionCost: totalCost.toFixed(6),
      effectiveRate: effectiveRate.toFixed(2),
      isViable: true,
    };
  }

  /**
   * Rank all adapters by cost for a given transaction, cheapest first.
   * Non-viable adapters are sorted to the end.
   */
  rankByCost(entries: AdapterEntry[], amount: string, currency: string): CostEstimate[] {
    const estimates = entries.map((entry) => this.estimateCost(entry, amount, currency));

    return estimates.sort((a, b) => {
      // Viable adapters come first
      if (a.isViable && !b.isViable) return -1;
      if (!a.isViable && b.isViable) return 1;

      // Among viable, sort by cost
      return parseFloat(a.transactionCost) - parseFloat(b.transactionCost);
    });
  }
}
