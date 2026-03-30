/**
 * @openagentpay/tax
 *
 * Tax calculation awareness for AI agent transactions.
 *
 * This package provides sales tax, VAT/GST, digital services tax
 * calculation, capital gains estimation for crypto payments, and
 * tax report generation — all designed for the automated,
 * high-volume, multi-jurisdiction world of AI agent commerce.
 *
 * @example
 * ```typescript
 * import { createCalculator, createReporter, taxMiddleware } from '@openagentpay/tax';
 *
 * const config = {
 *   defaultJurisdiction: 'US-CA',
 *   taxRates: {},
 *   exemptMethods: ['x402'],
 *   reportingThreshold: '100.00',
 *   currency: 'USD',
 * };
 *
 * // Calculate tax for a single transaction
 * const calc = createCalculator(config);
 * const result = calc.calculate('10.00', 'USD', 'stripe');
 *
 * // Track and report on transactions
 * const reporter = createReporter(config);
 * reporter.addTransaction(receipt);
 * const report = reporter.generateReport({ from: '2026-01-01', to: '2026-03-31' });
 *
 * // Enrich receipts in a pipeline
 * const mw = taxMiddleware(config);
 * const enriched = mw.enrichReceipt(receipt);
 * ```
 *
 * @packageDocumentation
 */

// Types
export type {
  TaxConfig,
  TaxJurisdiction,
  TaxCalculation,
  TaxType,
  TaxReport,
  TaxLineItem,
  CapitalGainsEvent,
} from "./types.js";

// Calculator
export { TaxCalculator } from "./calculator.js";

// Reporter
export { TaxReporter } from "./reporter.js";

// Middleware
export { taxMiddleware } from "./middleware.js";
export type {
  TaxEnrichedReceipt,
  TaxMiddleware,
  ReceiptProcessor,
} from "./middleware.js";

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

import type { TaxConfig } from "./types.js";
import { TaxCalculator } from "./calculator.js";
import { TaxReporter } from "./reporter.js";

/**
 * Create a new TaxCalculator with the given configuration.
 *
 * @param config - Tax configuration
 * @returns A configured TaxCalculator instance
 */
export function createCalculator(config: TaxConfig): TaxCalculator {
  return new TaxCalculator(config);
}

/**
 * Create a new TaxReporter with the given configuration.
 *
 * @param config - Tax configuration
 * @returns A configured TaxReporter instance
 */
export function createReporter(config: TaxConfig): TaxReporter {
  return new TaxReporter(config);
}
