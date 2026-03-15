/**
 * @module builders/payment-required
 *
 * Builder for constructing valid 402 Payment Required response bodies.
 */

import type {
  PaymentRequired,
  PaymentRequiredPricing,
  PaymentRequiredMeta,
  PaymentMethod,
  SubscriptionPlan,
} from "../types/payment-required.js";

// ---------------------------------------------------------------------------
// Builder Config
// ---------------------------------------------------------------------------

/**
 * Configuration for building a PaymentRequired response body.
 *
 * All pricing values use decimal strings for precision.
 */
export interface BuildPaymentRequiredConfig {
  /** The resource path being requested (e.g. `"/api/search"`). */
  resource: string;

  /** Per-request pricing information. */
  pricing: PaymentRequiredPricing;

  /** Available payment methods. At least one is required. */
  methods: PaymentMethod[];

  /** Optional subscription plans offered as alternatives. */
  subscriptions?: SubscriptionPlan[];

  /** Optional provider metadata. */
  meta?: PaymentRequiredMeta;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build a valid `PaymentRequired` response body for a 402 response.
 *
 * This function constructs a fully compliant 402 response body that
 * AI agents can parse to discover pricing, available payment methods,
 * and optional subscription plans.
 *
 * @param config - The pricing, methods, and metadata to include.
 * @returns A fully populated `PaymentRequired` object.
 * @throws {Error} If no payment methods are provided.
 *
 * @example
 * ```typescript
 * const body = buildPaymentRequired({
 *   resource: '/api/search',
 *   pricing: {
 *     amount: '0.01',
 *     currency: 'USDC',
 *     unit: 'per_request',
 *     description: 'Premium search query',
 *   },
 *   methods: [
 *     {
 *       type: 'x402',
 *       network: 'base',
 *       asset: 'USDC',
 *       asset_address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
 *       pay_to: '0x1234...',
 *       facilitator_url: 'https://x402.org/facilitator',
 *     },
 *   ],
 * });
 *
 * // Send as HTTP 402 response
 * res.status(402).json(body);
 * ```
 */
export function buildPaymentRequired(
  config: BuildPaymentRequiredConfig,
): PaymentRequired {
  if (!config.methods || config.methods.length === 0) {
    throw new Error(
      "At least one payment method is required in a 402 response.",
    );
  }

  const response: PaymentRequired = {
    type: "payment_required",
    version: "1.0",
    resource: config.resource,
    pricing: {
      amount: config.pricing.amount,
      currency: config.pricing.currency,
      unit: config.pricing.unit,
      ...(config.pricing.description !== undefined
        ? { description: config.pricing.description }
        : {}),
    },
    methods: config.methods,
  };

  if (config.subscriptions && config.subscriptions.length > 0) {
    response.subscriptions = config.subscriptions;
  }

  if (config.meta) {
    response.meta = config.meta;
  }

  return response;
}
