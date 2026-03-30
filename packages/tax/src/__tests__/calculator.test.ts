import { describe, it, expect } from "vitest";
import { TaxCalculator } from "../calculator.js";
import type { TaxConfig } from "../types.js";

function makeConfig(overrides: Partial<TaxConfig> = {}): TaxConfig {
  return {
    defaultJurisdiction: "US-CA",
    taxRates: {},
    exemptMethods: ["x402"],
    reportingThreshold: "100.00",
    currency: "USD",
    ...overrides,
  };
}

describe("TaxCalculator", () => {
  describe("US-CA sales tax (7.25%)", () => {
    it("calculates California sales tax correctly", () => {
      const calc = new TaxCalculator(makeConfig());
      const result = calc.calculate("10.00", "USD", "stripe", "US-CA");

      expect(result.taxRate).toBeCloseTo(0.0725);
      // 10 * 0.0725 = 0.725, toFixed(2) rounds to "0.72" (banker's rounding)
      expect(result.taxAmount).toBe("0.72");
      expect(result.netAmount).toBe("9.28");
      expect(result.grossAmount).toBe("10.00");
      expect(result.jurisdiction).toBe("US-CA");
      expect(result.taxType).toBe("sales");
    });

    it("includes breakdown with Sales Tax label", () => {
      const calc = new TaxCalculator(makeConfig());
      const result = calc.calculate("100.00", "USD", "stripe", "US-CA");

      expect(result.breakdown).toBeDefined();
      expect(result.breakdown!.length).toBeGreaterThan(0);
      expect(result.breakdown![0].label).toBe("Sales Tax");
      expect(result.breakdown![0].rate).toBe(0.0725);
      expect(result.breakdown![0].amount).toBe("7.25");
    });
  });

  describe("EU VAT (20% + 3% DST)", () => {
    it("calculates EU combined rate (VAT + DST)", () => {
      const calc = new TaxCalculator(makeConfig());
      const result = calc.calculate("10.00", "USD", "stripe", "EU");

      // EU has 0.20 sales tax + 0.03 DST = 0.23 combined
      expect(result.taxRate).toBeCloseTo(0.23);
      expect(result.taxAmount).toBe("2.30");
      expect(result.netAmount).toBe("7.70");
      expect(result.taxType).toBe("dst");
    });

    it("includes VAT and DST in breakdown", () => {
      const calc = new TaxCalculator(makeConfig());
      const result = calc.calculate("100.00", "USD", "stripe", "EU");

      expect(result.breakdown).toBeDefined();
      expect(result.breakdown!.length).toBe(2);

      const vatLine = result.breakdown!.find((b) => b.label === "VAT");
      const dstLine = result.breakdown!.find(
        (b) => b.label === "Digital Services Tax"
      );

      expect(vatLine).toBeDefined();
      expect(vatLine!.rate).toBe(0.2);
      expect(vatLine!.amount).toBe("20.00");

      expect(dstLine).toBeDefined();
      expect(dstLine!.rate).toBe(0.03);
      expect(dstLine!.amount).toBe("3.00");
    });
  });

  describe("India GST (18%)", () => {
    it("calculates Indian GST correctly", () => {
      const calc = new TaxCalculator(makeConfig());
      const result = calc.calculate("10.00", "USD", "stripe", "IN");

      expect(result.taxRate).toBeCloseTo(0.18);
      expect(result.taxAmount).toBe("1.80");
      expect(result.netAmount).toBe("8.20");
      expect(result.jurisdiction).toBe("IN");
      expect(result.taxType).toBe("sales");
    });

    it("has GST label in breakdown", () => {
      const calc = new TaxCalculator(makeConfig());
      const result = calc.calculate("50.00", "USD", "stripe", "IN");

      expect(result.breakdown).toBeDefined();
      expect(result.breakdown![0].label).toBe("GST");
    });
  });

  describe("crypto payment exemption", () => {
    it("returns zero tax for x402 payment method", () => {
      const calc = new TaxCalculator(makeConfig());
      const result = calc.calculate("10.00", "USDC", "x402", "US-CA");

      expect(result.taxAmount).toBe("0.00");
      expect(result.taxRate).toBe(0);
      expect(result.taxType).toBe("exempt");
      expect(result.grossAmount).toBe("10.00");
      expect(result.netAmount).toBe("10.00");
    });

    it("returns zero tax for custom exempt methods", () => {
      const calc = new TaxCalculator(
        makeConfig({ exemptMethods: ["x402", "solana", "lightning"] })
      );

      for (const method of ["x402", "solana", "lightning"]) {
        const result = calc.calculate("10.00", "USDC", method, "US-CA");
        expect(result.taxType).toBe("exempt");
        expect(result.taxAmount).toBe("0.00");
      }
    });
  });

  describe("custom rate override", () => {
    it("uses custom rate instead of built-in jurisdiction rate", () => {
      const calc = new TaxCalculator(
        makeConfig({
          taxRates: { "US-CA": 0.1 },
        })
      );
      const result = calc.calculate("10.00", "USD", "stripe", "US-CA");

      expect(result.taxRate).toBeCloseTo(0.1);
      expect(result.taxAmount).toBe("1.00");
      expect(result.netAmount).toBe("9.00");
    });

    it("uses custom rate for unknown jurisdictions", () => {
      const calc = new TaxCalculator(
        makeConfig({
          taxRates: { "XX-CUSTOM": 0.15 },
        })
      );
      const result = calc.calculate("20.00", "USD", "stripe", "XX-CUSTOM");

      expect(result.taxRate).toBeCloseTo(0.15);
      expect(result.taxAmount).toBe("3.00");
    });
  });

  describe("zero tax for exempt methods", () => {
    it("returns exempt type and zero amounts", () => {
      const calc = new TaxCalculator(
        makeConfig({ exemptMethods: ["x402", "free-tier"] })
      );
      const result = calc.calculate("100.00", "USD", "free-tier", "EU");

      expect(result.taxType).toBe("exempt");
      expect(result.taxAmount).toBe("0.00");
      expect(result.taxRate).toBe(0);
      expect(result.netAmount).toBe("100.00");
    });
  });

  describe("edge cases", () => {
    it("returns zero tax for unknown jurisdiction without override", () => {
      const calc = new TaxCalculator(makeConfig());
      const result = calc.calculate("10.00", "USD", "stripe", "ZZ-UNKNOWN");

      expect(result.taxRate).toBe(0);
      expect(result.taxAmount).toBe("0.00");
      expect(result.taxType).toBe("none");
    });

    it("handles negative amounts gracefully", () => {
      const calc = new TaxCalculator(makeConfig());
      const result = calc.calculate("-5.00", "USD", "stripe", "US-CA");

      expect(result.taxAmount).toBe("0.00");
      expect(result.taxType).toBe("none");
    });

    it("handles NaN amounts gracefully", () => {
      const calc = new TaxCalculator(makeConfig());
      const result = calc.calculate("not-a-number", "USD", "stripe", "US-CA");

      expect(result.taxAmount).toBe("0.00");
      expect(result.taxType).toBe("none");
    });

    it("falls back to defaultJurisdiction when none specified", () => {
      const calc = new TaxCalculator(
        makeConfig({ defaultJurisdiction: "US-NY" })
      );
      const result = calc.calculate("10.00", "USD", "stripe");

      expect(result.jurisdiction).toBe("US-NY");
      expect(result.taxRate).toBeCloseTo(0.08);
    });

    it("returns zero tax for Delaware (0% sales tax)", () => {
      const calc = new TaxCalculator(makeConfig());
      const result = calc.calculate("10.00", "USD", "stripe", "US-DE");

      expect(result.taxRate).toBe(0);
      expect(result.taxAmount).toBe("0.00");
      expect(result.taxType).toBe("none");
    });
  });
});
