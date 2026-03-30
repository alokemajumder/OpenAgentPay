/**
 * @module types
 *
 * Types for the tax calculation and reporting system.
 * These types model tax jurisdictions, calculation results,
 * reports, and capital gains events for AI agent transactions.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the tax calculation engine.
 */
export interface TaxConfig {
  /** Default jurisdiction code when none is specified (e.g. "US-CA", "GB"). */
  defaultJurisdiction: string;

  /** Map of jurisdiction code to tax rate (0–1 decimal, e.g. 0.20 = 20%). */
  taxRates: Record<string, number>;

  /** Payment methods exempt from tax (e.g. crypto-to-crypto swaps). */
  exemptMethods: string[];

  /** Amount threshold above which reports should be generated (decimal string). */
  reportingThreshold: string;

  /** Base currency for tax reporting (e.g. "USD"). */
  currency: string;
}

// ---------------------------------------------------------------------------
// Jurisdiction
// ---------------------------------------------------------------------------

/**
 * A tax jurisdiction with its applicable rates.
 */
export interface TaxJurisdiction {
  /** Jurisdiction code (e.g. "US-CA", "GB", "IN", "JP"). */
  jurisdiction: string;

  /** Human-readable name. */
  name: string;

  /** Standard sales tax / VAT / GST rate (0–1 decimal). */
  salesTaxRate: number;

  /** Digital Services Tax rate, if applicable. */
  digitalServicesTax?: number;

  /** Withholding tax rate for cross-border payments, if applicable. */
  withholdingRate?: number;
}

// ---------------------------------------------------------------------------
// Calculation Result
// ---------------------------------------------------------------------------

/**
 * The type of tax applied to a transaction.
 *
 * - `sales` — standard sales tax, VAT, or GST
 * - `dst` — digital services tax
 * - `none` — no tax applied (e.g. jurisdiction has 0% rate)
 * - `exempt` — payment method is explicitly exempt
 */
export type TaxType = "sales" | "dst" | "none" | "exempt";

/**
 * Result of a tax calculation for a single transaction.
 */
export interface TaxCalculation {
  /** Original amount before tax. */
  grossAmount: string;

  /** Tax amount. */
  taxAmount: string;

  /** Amount after tax (grossAmount - taxAmount for inclusive, or total for exclusive). */
  netAmount: string;

  /** Effective tax rate applied (0–1 decimal). */
  taxRate: number;

  /** Jurisdiction the tax was calculated for. */
  jurisdiction: string;

  /** Which type of tax was applied. */
  taxType: TaxType;

  /** Optional breakdown by tax component. */
  breakdown?: Array<{ label: string; rate: number; amount: string }>;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/**
 * A single line item in a tax report.
 */
export interface TaxLineItem {
  /** ISO 8601 timestamp of the transaction. */
  timestamp: string;

  /** Transaction amount (decimal string). */
  amount: string;

  /** Tax charged on this transaction (decimal string). */
  tax: string;

  /** Payment method used. */
  method: string;

  /** Payee identifier or name. */
  payee: string;

  /** Receipt identifier for cross-referencing. */
  receiptId: string;
}

/**
 * Aggregated tax report for a period and jurisdiction.
 */
export interface TaxReport {
  /** Reporting period. */
  period: { from: string; to: string };

  /** Jurisdiction this report covers. */
  jurisdiction: string;

  /** Total gross amount across all transactions (decimal string). */
  totalGross: string;

  /** Total tax collected/owed (decimal string). */
  totalTax: string;

  /** Total net amount (decimal string). */
  totalNet: string;

  /** Number of transactions in this report. */
  transactionCount: number;

  /** Individual transaction line items. */
  lineItems: TaxLineItem[];
}

// ---------------------------------------------------------------------------
// Capital Gains
// ---------------------------------------------------------------------------

/**
 * A capital gains event for cryptocurrency payments.
 * Used when crypto is disposed of (spent) for a service.
 */
export interface CapitalGainsEvent {
  /** Cost at which the crypto was acquired (decimal string in fiat). */
  acquisitionCost: string;

  /** Amount received / fair market value at disposal (decimal string in fiat). */
  disposalAmount: string;

  /** Gain or loss (disposalAmount - acquisitionCost, decimal string). */
  gain: string;

  /** How long the asset was held, in days. */
  holdingPeriod: number;

  /** Whether this is a short-term gain (typically < 365 days). */
  shortTerm: boolean;
}
