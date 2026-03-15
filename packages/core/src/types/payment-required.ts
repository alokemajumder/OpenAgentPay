/**
 * @module payment-required
 *
 * Types for the HTTP 402 Payment Required response standard.
 * This is the machine-readable format that API providers return
 * when a request requires payment.
 */

// ---------------------------------------------------------------------------
// Payment Methods
// ---------------------------------------------------------------------------

/**
 * x402 stablecoin payment method.
 *
 * Describes how to pay via on-chain stablecoin transfer using the
 * x402 protocol (EIP-3009 transferWithAuthorization).
 */
export interface X402PaymentMethod {
  /** Discriminator — always `"x402"` for on-chain stablecoin payments. */
  type: "x402";

  /** Blockchain network identifier (e.g. `"base"`, `"base-sepolia"`). */
  network: string;

  /** Token symbol (e.g. `"USDC"`). */
  asset: string;

  /** ERC-20 token contract address on the specified network. */
  asset_address: string;

  /** Recipient wallet address that will receive the payment. */
  pay_to: string;

  /** URL of the x402 facilitator service that settles the payment. */
  facilitator_url: string;

  /** Maximum seconds the payment authorization remains valid. */
  max_timeout_seconds?: number;
}

/**
 * Prepaid credit balance payment method.
 *
 * The agent purchases credits in advance and spends them per-call.
 */
export interface CreditsPaymentMethod {
  /** Discriminator — always `"credits"` for prepaid balance payments. */
  type: "credits";

  /** URL where credits can be purchased. */
  purchase_url: string;

  /** URL where the current credit balance can be queried. */
  balance_url: string;
}

/**
 * Union of all supported payment methods.
 *
 * Each variant is discriminated by the `type` field so consumers
 * can narrow with a simple `switch` or `if` check.
 */
export type PaymentMethod = X402PaymentMethod | CreditsPaymentMethod;

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

/**
 * Per-request pricing information returned in the 402 response.
 */
export interface PaymentRequiredPricing {
  /** Amount as a decimal string (e.g. `"0.01"`). */
  amount: string;

  /** Currency code — ISO 4217 fiat code or token symbol (e.g. `"USDC"`). */
  currency: string;

  /** What the amount covers. */
  unit: "per_request" | "per_kb" | "per_second" | "per_unit";

  /** Human-readable description of what the charge covers. */
  description?: string;
}

// ---------------------------------------------------------------------------
// Subscription Plan
// ---------------------------------------------------------------------------

/**
 * A subscription plan offered by the API provider as an alternative
 * to per-request pricing.
 *
 * Agents can evaluate whether subscribing saves money based on their
 * projected call volume.
 */
export interface SubscriptionPlan {
  /** Unique plan identifier (e.g. `"daily-1000"`). */
  id: string;

  /** Cost of the subscription as a decimal string (e.g. `"5.00"`). */
  amount: string;

  /** Currency code. */
  currency: string;

  /** Billing period — how long one subscription term lasts. */
  period: "hour" | "day" | "week" | "month";

  /** Call limit within the period. `"unlimited"` means no cap. */
  calls: number | "unlimited";

  /** Rate limit in calls per minute. `null` means no rate limit. */
  rate_limit?: number | null;

  /** Human-readable description of the plan. */
  description?: string;

  /** Whether the plan supports automatic renewal. */
  auto_renew?: boolean;
}

// ---------------------------------------------------------------------------
// Provider Metadata
// ---------------------------------------------------------------------------

/**
 * Optional metadata about the API provider, included in the 402 response.
 */
export interface PaymentRequiredMeta {
  /** Provider name or identifier. */
  provider?: string;

  /** URL to API documentation. */
  docs_url?: string;

  /** URL to terms of service. */
  tos_url?: string;

  /** Endpoint to subscribe to a plan. */
  subscribe_url?: string;

  /** Endpoint to check subscription status. */
  subscription_status_url?: string;

  /** Endpoint to cancel a subscription. */
  unsubscribe_url?: string;
}

// ---------------------------------------------------------------------------
// PaymentRequired (top-level 402 body)
// ---------------------------------------------------------------------------

/**
 * The machine-readable HTTP 402 Payment Required response body.
 *
 * This is the most strategically important schema in OpenAgentPay.
 * When an API endpoint requires payment, it returns this structure
 * so that AI agents can programmatically discover the price,
 * select a payment method, and complete the transaction.
 *
 * @example
 * ```json
 * {
 *   "type": "payment_required",
 *   "version": "1.0",
 *   "resource": "/api/search",
 *   "pricing": {
 *     "amount": "0.01",
 *     "currency": "USDC",
 *     "unit": "per_request"
 *   },
 *   "methods": [
 *     { "type": "x402", "network": "base", ... }
 *   ]
 * }
 * ```
 */
export interface PaymentRequired {
  /** Schema identifier — always `"payment_required"`. */
  type: "payment_required";

  /** Schema version — currently `"1.0"`. */
  version: "1.0";

  /** The resource (URL path) being requested. */
  resource: string;

  /** Per-request pricing information. */
  pricing: PaymentRequiredPricing;

  /** Available subscription plans as alternatives to per-request pricing. */
  subscriptions?: SubscriptionPlan[];

  /** Available payment methods the agent can use. */
  methods: PaymentMethod[];

  /** Optional provider metadata. */
  meta?: PaymentRequiredMeta;
}
