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

/** Stripe payment method — for per-call charges or credit purchases. */
export interface StripePaymentMethod {
  /** Discriminator — always `"stripe"` for Stripe-based payments. */
  type: 'stripe';
  /** Stripe publishable key (for client-side). */
  publishable_key?: string;
  /** URL to purchase credits via Stripe Checkout. */
  checkout_url?: string;
  /** URL to set up a payment method for direct charges. */
  setup_url?: string;
  /** Whether direct per-call charging is supported (minimum $0.50). */
  direct_charge?: boolean;
}

/** PayPal payment method — for billing agreements or credit purchases. */
export interface PayPalPaymentMethod {
  /** Discriminator — always `"paypal"` for PayPal-based payments. */
  type: 'paypal';
  /** URL to purchase credits via PayPal. */
  checkout_url?: string;
  /** URL to create a PayPal billing agreement for recurring charges. */
  agreement_url?: string;
  /** PayPal client ID (for client-side SDK). */
  client_id?: string;
}

/** UPI payment method (India) — for mandate-based charges or credit purchases. */
export interface UPIPaymentMethod {
  /** Discriminator — always `"upi"` for UPI-based payments. */
  type: 'upi';
  /** URL to purchase credits via UPI payment. */
  checkout_url?: string;
  /** URL to create a UPI AutoPay mandate. */
  mandate_url?: string;
  /** Payment gateway provider name. */
  gateway?: string;
}

/** MPP (Machine Payments Protocol) payment method — Stripe + Tempo backed. */
export interface MPPPaymentMethod {
  /** Discriminator — always `"mpp"` for Machine Payments Protocol. */
  type: 'mpp';
  /** The MPP challenge ID from the 402 response. */
  challenge_id: string;
  /** Payment networks accepted (e.g., 'tempo', 'stripe', 'lightning'). */
  networks: string[];
  /** Amount in smallest unit. */
  amount: string;
  /** Currency code. */
  currency: string;
  /** Recipient address or account. */
  recipient: string;
  /** MPP server URL for credential submission. */
  server_url?: string;
  /** Whether sessions (streaming/aggregated payments) are supported. */
  sessions_supported?: boolean;
}

/** Visa Intelligent Commerce payment method — via Visa MCP or AgentCard. */
export interface VisaPaymentMethod {
  /** Discriminator — always `"visa"` for Visa payments. */
  type: 'visa';
  /** Visa MCP server URL. */
  mcp_url?: string;
  /** AgentCard API URL. */
  agentcard_url?: string;
  /** Whether tokenized card credentials are supported. */
  tokenized?: boolean;
  /** Merchant category code (if required). */
  mcc?: string;
}

/**
 * Union of all supported payment methods.
 *
 * Each variant is discriminated by the `type` field so consumers
 * can narrow with a simple `switch` or `if` check.
 */
export type PaymentMethod =
  | X402PaymentMethod
  | CreditsPaymentMethod
  | StripePaymentMethod
  | PayPalPaymentMethod
  | UPIPaymentMethod
  | MPPPaymentMethod
  | VisaPaymentMethod;

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
