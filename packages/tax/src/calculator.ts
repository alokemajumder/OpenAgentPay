/**
 * @module calculator
 *
 * Tax calculation engine for AI agent transactions.
 * Handles sales tax, VAT, GST, and digital services tax
 * across multiple jurisdictions with crypto exemptions.
 */

import type {
  TaxConfig,
  TaxCalculation,
  TaxJurisdiction,
  TaxType,
} from "./types.js";

// ---------------------------------------------------------------------------
// Built-in jurisdiction definitions
// ---------------------------------------------------------------------------

const BUILT_IN_JURISDICTIONS: TaxJurisdiction[] = [
  // United States — state-level rates (common examples)
  { jurisdiction: "US-CA", name: "California", salesTaxRate: 0.0725 },
  { jurisdiction: "US-NY", name: "New York", salesTaxRate: 0.08 },
  { jurisdiction: "US-TX", name: "Texas", salesTaxRate: 0.0625 },
  { jurisdiction: "US-WA", name: "Washington", salesTaxRate: 0.065 },
  { jurisdiction: "US-FL", name: "Florida", salesTaxRate: 0.06 },
  { jurisdiction: "US-DE", name: "Delaware", salesTaxRate: 0 },

  // European Union — digital services tax
  {
    jurisdiction: "EU",
    name: "European Union",
    salesTaxRate: 0.2,
    digitalServicesTax: 0.03,
  },

  // United Kingdom — VAT
  { jurisdiction: "GB", name: "United Kingdom", salesTaxRate: 0.2 },

  // India — GST on digital services
  {
    jurisdiction: "IN",
    name: "India",
    salesTaxRate: 0.18,
    withholdingRate: 0.02,
  },

  // Japan — consumption tax
  { jurisdiction: "JP", name: "Japan", salesTaxRate: 0.1 },

  // Singapore — GST
  { jurisdiction: "SG", name: "Singapore", salesTaxRate: 0.09 },
];

/**
 * Payment methods that are typically crypto-to-crypto and
 * thus exempt from sales tax in many jurisdictions.
 */
const DEFAULT_CRYPTO_METHODS = ["x402", "solana", "lightning"];

// ---------------------------------------------------------------------------
// TaxCalculator
// ---------------------------------------------------------------------------

/**
 * Calculates tax for AI agent payment transactions.
 *
 * @example
 * ```typescript
 * const calc = new TaxCalculator({
 *   defaultJurisdiction: 'US-CA',
 *   taxRates: {},
 *   exemptMethods: ['x402'],
 *   reportingThreshold: '100.00',
 *   currency: 'USD',
 * });
 *
 * const result = calc.calculate('10.00', 'USD', 'stripe', 'US-CA');
 * // result.taxAmount === '0.73' (7.25% California sales tax)
 * ```
 */
export class TaxCalculator {
  private readonly config: TaxConfig;
  private readonly jurisdictions: Map<string, TaxJurisdiction>;

  constructor(config: TaxConfig) {
    this.config = config;

    // Index built-in jurisdictions
    this.jurisdictions = new Map<string, TaxJurisdiction>();
    for (const j of BUILT_IN_JURISDICTIONS) {
      this.jurisdictions.set(j.jurisdiction, j);
    }
  }

  /**
   * Calculate tax for a transaction.
   *
   * @param amount  - Transaction amount as a decimal string
   * @param currency - Currency code (e.g. "USD", "USDC")
   * @param method  - Payment method identifier
   * @param jurisdiction - Optional jurisdiction override; falls back to default
   * @returns A TaxCalculation with gross, tax, and net amounts
   */
  calculate(
    amount: string,
    currency: string,
    method: string,
    jurisdiction?: string,
  ): TaxCalculation {
    const effectiveJurisdiction =
      jurisdiction ?? this.config.defaultJurisdiction;
    const gross = parseFloat(amount);

    if (isNaN(gross) || gross < 0) {
      return {
        grossAmount: amount,
        taxAmount: "0.00",
        netAmount: amount,
        taxRate: 0,
        jurisdiction: effectiveJurisdiction,
        taxType: "none",
      };
    }

    // Check exemptions first
    if (this.isExempt(method)) {
      return {
        grossAmount: this.formatAmount(gross),
        taxAmount: "0.00",
        netAmount: this.formatAmount(gross),
        taxRate: 0,
        jurisdiction: effectiveJurisdiction,
        taxType: "exempt",
      };
    }

    const rate = this.getEffectiveRate(effectiveJurisdiction, method);
    const taxAmount = gross * rate;
    const netAmount = gross - taxAmount;
    const taxType = this.determineTaxType(effectiveJurisdiction, rate);

    const breakdown: Array<{ label: string; rate: number; amount: string }> =
      [];
    const jur = this.jurisdictions.get(effectiveJurisdiction);

    if (jur) {
      if (jur.salesTaxRate > 0) {
        const salesTax = gross * jur.salesTaxRate;
        breakdown.push({
          label: this.getSalesTaxLabel(effectiveJurisdiction),
          rate: jur.salesTaxRate,
          amount: this.formatAmount(salesTax),
        });
      }
      if (jur.digitalServicesTax && jur.digitalServicesTax > 0) {
        const dst = gross * jur.digitalServicesTax;
        breakdown.push({
          label: "Digital Services Tax",
          rate: jur.digitalServicesTax,
          amount: this.formatAmount(dst),
        });
      }
    }

    return {
      grossAmount: this.formatAmount(gross),
      taxAmount: this.formatAmount(taxAmount),
      netAmount: this.formatAmount(netAmount),
      taxRate: rate,
      jurisdiction: effectiveJurisdiction,
      taxType,
      breakdown: breakdown.length > 0 ? breakdown : undefined,
    };
  }

  /**
   * Check whether a payment method is exempt from tax.
   * Crypto-to-crypto methods are typically exempt.
   *
   * @param method - The payment method to check
   * @returns true if the method is tax-exempt
   */
  isExempt(method: string): boolean {
    // User-configured exemptions
    if (this.config.exemptMethods.includes(method)) {
      return true;
    }
    return false;
  }

  /**
   * Get the effective tax rate for a jurisdiction and payment method.
   * Combines sales tax and digital services tax where applicable.
   *
   * @param jurisdiction - Jurisdiction code
   * @param method - Payment method identifier
   * @returns The combined tax rate as a 0–1 decimal
   */
  getEffectiveRate(jurisdiction: string, method: string): number {
    // Exempt methods always have 0 rate
    if (this.isExempt(method)) {
      return 0;
    }

    // Check user-configured overrides first
    if (this.config.taxRates[jurisdiction] !== undefined) {
      return this.config.taxRates[jurisdiction];
    }

    // Fall back to built-in jurisdiction data
    const jur = this.jurisdictions.get(jurisdiction);
    if (!jur) {
      return 0;
    }

    let rate = jur.salesTaxRate;

    // Add DST for digital service payments (agent API calls are digital services)
    if (jur.digitalServicesTax) {
      rate += jur.digitalServicesTax;
    }

    return rate;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private determineTaxType(jurisdiction: string, rate: number): TaxType {
    if (rate === 0) return "none";

    const jur = this.jurisdictions.get(jurisdiction);
    if (jur?.digitalServicesTax && jur.digitalServicesTax > 0) {
      return "dst";
    }

    return "sales";
  }

  private getSalesTaxLabel(jurisdiction: string): string {
    if (jurisdiction.startsWith("US-")) return "Sales Tax";
    if (jurisdiction === "GB") return "VAT";
    if (jurisdiction === "IN" || jurisdiction === "SG") return "GST";
    if (jurisdiction === "JP") return "Consumption Tax";
    if (jurisdiction === "EU") return "VAT";
    return "Sales Tax";
  }

  private formatAmount(value: number): string {
    return value.toFixed(2);
  }
}
