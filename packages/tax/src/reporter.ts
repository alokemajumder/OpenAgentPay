/**
 * @module reporter
 *
 * Tax reporting for AI agent payment transactions.
 * Tracks taxable events, generates period reports,
 * calculates capital gains, and exports to CSV/JSON.
 */

import type { AgentPaymentReceipt } from "@openagentpay/core";
import { TaxCalculator } from "./calculator.js";
import type {
  TaxConfig,
  TaxReport,
  TaxLineItem,
  CapitalGainsEvent,
} from "./types.js";

// ---------------------------------------------------------------------------
// TaxReporter
// ---------------------------------------------------------------------------

/**
 * Records taxable events from payment receipts and generates
 * aggregated tax reports for compliance and accounting.
 *
 * @example
 * ```typescript
 * const reporter = new TaxReporter(config);
 *
 * // Record transactions as they happen
 * reporter.addTransaction(receipt);
 *
 * // Generate a quarterly report
 * const report = reporter.generateReport({
 *   from: '2026-01-01T00:00:00Z',
 *   to: '2026-03-31T23:59:59Z',
 * });
 *
 * // Export for accounting
 * const csv = reporter.exportCSV(report);
 * ```
 */
export class TaxReporter {
  private readonly config: TaxConfig;
  private readonly calculator: TaxCalculator;
  private readonly lineItems: TaxLineItem[] = [];

  constructor(config: TaxConfig) {
    this.config = config;
    this.calculator = new TaxCalculator(config);
  }

  /**
   * Record a payment receipt as a taxable event.
   *
   * @param receipt - The AgentPaymentReceipt to record
   * @param jurisdiction - Optional jurisdiction override
   */
  addTransaction(
    receipt: AgentPaymentReceipt,
    jurisdiction?: string,
  ): void {
    const effectiveJurisdiction =
      jurisdiction ?? this.config.defaultJurisdiction;

    const calc = this.calculator.calculate(
      receipt.payment.amount,
      receipt.payment.currency,
      receipt.payment.method,
      effectiveJurisdiction,
    );

    const lineItem: TaxLineItem = {
      timestamp: receipt.timestamp,
      amount: calc.grossAmount,
      tax: calc.taxAmount,
      method: receipt.payment.method,
      payee: receipt.payee.identifier,
      receiptId: receipt.id,
    };

    this.lineItems.push(lineItem);
  }

  /**
   * Generate a tax report for a given period and optional jurisdiction.
   *
   * @param period - The date range to report on (ISO 8601 strings)
   * @param jurisdiction - Optional jurisdiction filter
   * @returns An aggregated TaxReport
   */
  generateReport(
    period: { from: string; to: string },
    jurisdiction?: string,
  ): TaxReport {
    const effectiveJurisdiction =
      jurisdiction ?? this.config.defaultJurisdiction;

    const fromTime = new Date(period.from).getTime();
    const toTime = new Date(period.to).getTime();

    // Filter line items by period
    const filtered = this.lineItems.filter((item) => {
      const t = new Date(item.timestamp).getTime();
      return t >= fromTime && t <= toTime;
    });

    let totalGross = 0;
    let totalTax = 0;
    let totalNet = 0;

    for (const item of filtered) {
      const gross = parseFloat(item.amount);
      const tax = parseFloat(item.tax);
      totalGross += gross;
      totalTax += tax;
      totalNet += gross - tax;
    }

    return {
      period,
      jurisdiction: effectiveJurisdiction,
      totalGross: totalGross.toFixed(2),
      totalTax: totalTax.toFixed(2),
      totalNet: totalNet.toFixed(2),
      transactionCount: filtered.length,
      lineItems: filtered,
    };
  }

  /**
   * Calculate capital gains for a set of crypto disposal events.
   * Each event represents a crypto asset that was spent/disposed of
   * in exchange for a service.
   *
   * @param transactions - Array of CapitalGainsEvent entries
   * @returns Summary with total short-term and long-term gains
   */
  getCapitalGains(transactions: CapitalGainsEvent[]): {
    totalGain: string;
    shortTermGain: string;
    longTermGain: string;
    events: CapitalGainsEvent[];
  } {
    let shortTermGain = 0;
    let longTermGain = 0;

    for (const event of transactions) {
      const gain = parseFloat(event.gain);
      if (event.shortTerm) {
        shortTermGain += gain;
      } else {
        longTermGain += gain;
      }
    }

    const totalGain = shortTermGain + longTermGain;

    return {
      totalGain: totalGain.toFixed(2),
      shortTermGain: shortTermGain.toFixed(2),
      longTermGain: longTermGain.toFixed(2),
      events: transactions,
    };
  }

  /**
   * Export a TaxReport as a CSV string.
   *
   * @param report - The report to export
   * @returns A CSV string with headers
   */
  exportCSV(report: TaxReport): string {
    const headers = [
      "timestamp",
      "amount",
      "tax",
      "method",
      "payee",
      "receiptId",
    ];
    const lines: string[] = [headers.join(",")];

    for (const item of report.lineItems) {
      const row = [
        this.escapeCSV(item.timestamp),
        item.amount,
        item.tax,
        this.escapeCSV(item.method),
        this.escapeCSV(item.payee),
        this.escapeCSV(item.receiptId),
      ];
      lines.push(row.join(","));
    }

    // Append summary row
    lines.push("");
    lines.push(
      `Period,${report.period.from} to ${report.period.to}`,
    );
    lines.push(`Jurisdiction,${report.jurisdiction}`);
    lines.push(`Total Gross,${report.totalGross}`);
    lines.push(`Total Tax,${report.totalTax}`);
    lines.push(`Total Net,${report.totalNet}`);
    lines.push(`Transaction Count,${report.transactionCount}`);

    return lines.join("\n");
  }

  /**
   * Export a TaxReport as a formatted JSON string.
   *
   * @param report - The report to export
   * @returns A prettified JSON string
   */
  exportJSON(report: TaxReport): string {
    return JSON.stringify(report, null, 2);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Escape a value for safe inclusion in CSV output.
   */
  private escapeCSV(value: string): string {
    if (value.includes(",") || value.includes('"') || value.includes("\n")) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
