/**
 * @module middleware
 *
 * Tax middleware for the OpenAgentPay receipt pipeline.
 * Enriches payment receipts with tax calculation data
 * so downstream consumers (analytics, accounting, compliance)
 * have tax information attached to each transaction.
 */

import type { AgentPaymentReceipt } from "@openagentpay/core";
import { TaxCalculator } from "./calculator.js";
import type { TaxConfig, TaxCalculation } from "./types.js";

// ---------------------------------------------------------------------------
// Enriched receipt type
// ---------------------------------------------------------------------------

/**
 * A payment receipt enriched with tax calculation data.
 */
export interface TaxEnrichedReceipt extends AgentPaymentReceipt {
  /** Tax calculation result attached by the middleware. */
  tax: TaxCalculation;
}

// ---------------------------------------------------------------------------
// Middleware types
// ---------------------------------------------------------------------------

/**
 * A receipt processing function that takes a receipt and returns
 * a (possibly enriched) receipt, or a promise thereof.
 */
export type ReceiptProcessor<T extends AgentPaymentReceipt = AgentPaymentReceipt> = (
  receipt: T,
) => T | Promise<T>;

// ---------------------------------------------------------------------------
// taxMiddleware
// ---------------------------------------------------------------------------

/**
 * Creates a middleware function that enriches receipts with tax data.
 *
 * The returned function wraps receipt processing: it calculates
 * the tax for each receipt based on its payment method, amount,
 * and jurisdiction, then attaches the result as a `tax` field.
 *
 * @param config - Tax configuration
 * @returns A function that wraps a receipt processor with tax enrichment
 *
 * @example
 * ```typescript
 * const withTax = taxMiddleware({
 *   defaultJurisdiction: 'US-CA',
 *   taxRates: {},
 *   exemptMethods: ['x402'],
 *   reportingThreshold: '100.00',
 *   currency: 'USD',
 * });
 *
 * // Wrap an existing processor
 * const process = withTax((receipt) => {
 *   console.log('Tax:', receipt.tax.taxAmount);
 *   return receipt;
 * });
 *
 * // Or use enrichReceipt directly
 * const { enrichReceipt } = withTax;
 * const enriched = enrichReceipt(receipt, 'US-CA');
 * ```
 */
export function taxMiddleware(config: TaxConfig): TaxMiddleware {
  const calculator = new TaxCalculator(config);

  /**
   * Enrich a single receipt with tax calculation data.
   */
  function enrichReceipt(
    receipt: AgentPaymentReceipt,
    jurisdiction?: string,
  ): TaxEnrichedReceipt {
    const taxCalc = calculator.calculate(
      receipt.payment.amount,
      receipt.payment.currency,
      receipt.payment.method,
      jurisdiction ?? config.defaultJurisdiction,
    );

    return {
      ...receipt,
      tax: taxCalc,
    };
  }

  /**
   * Wrap a receipt processor so every receipt is tax-enriched
   * before it reaches the inner function.
   */
  function wrap(
    processor: ReceiptProcessor<TaxEnrichedReceipt>,
  ): ReceiptProcessor<AgentPaymentReceipt> {
    return (receipt: AgentPaymentReceipt) => {
      const enriched = enrichReceipt(receipt);
      return processor(enriched);
    };
  }

  // Attach enrichReceipt as a property for direct usage
  wrap.enrichReceipt = enrichReceipt;
  wrap.calculator = calculator;

  return wrap as TaxMiddleware;
}

/**
 * The tax middleware function with utility methods attached.
 */
export interface TaxMiddleware {
  /**
   * Wrap a receipt processor with tax enrichment.
   */
  (
    processor: ReceiptProcessor<TaxEnrichedReceipt>,
  ): ReceiptProcessor<AgentPaymentReceipt>;

  /**
   * Enrich a single receipt with tax data without wrapping a processor.
   */
  enrichReceipt: (
    receipt: AgentPaymentReceipt,
    jurisdiction?: string,
  ) => TaxEnrichedReceipt;

  /** The underlying tax calculator. */
  calculator: TaxCalculator;
}
