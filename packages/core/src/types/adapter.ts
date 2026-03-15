/**
 * @module adapter
 *
 * Types for the PaymentAdapter interface — the pluggable payment
 * method abstraction that enables OpenAgentPay to support multiple
 * payment rails (x402, credits, mock, future methods).
 */

import type { AgentPaymentReceipt } from "./receipt.js";
import type { PaymentMethod } from "./payment-required.js";

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

/**
 * Pricing information passed to adapters during verification.
 *
 * This is the resolved price for a specific request, which may
 * come from static configuration or a dynamic pricing function.
 */
export interface Pricing {
  /** Amount as a decimal string (e.g. `"0.01"`). */
  amount: string;

  /** Currency code or token symbol. */
  currency: string;

  /** Human-readable description of what the charge covers. */
  description?: string;
}

// ---------------------------------------------------------------------------
// Adapter Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration passed to an adapter when generating the payment
 * method block for a 402 response.
 */
export interface AdapterConfig {
  /** Recipient wallet address or account identifier. */
  recipient: string;

  /** Additional adapter-specific configuration. */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Verification Result
// ---------------------------------------------------------------------------

/**
 * Result returned by an adapter after verifying a payment proof.
 */
export interface VerifyResult {
  /** Whether the payment proof is valid and sufficient. */
  valid: boolean;

  /** Partial receipt data extracted during verification. */
  receipt?: Partial<AgentPaymentReceipt>;

  /** Human-readable error message if verification failed. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Payment Proof
// ---------------------------------------------------------------------------

/**
 * A payment proof that the client attaches to the retry request.
 *
 * The adapter generates this after executing a payment, and the
 * client sends it as an HTTP header on the subsequent request.
 */
export interface PaymentProof {
  /** HTTP header name to attach (e.g. `"X-PAYMENT"`). */
  header: string;

  /** HTTP header value containing the proof. */
  value: string;
}

// ---------------------------------------------------------------------------
// Incoming Request (adapter-facing)
// ---------------------------------------------------------------------------

/**
 * Minimal request interface that adapters receive for detection
 * and verification.
 *
 * This is deliberately minimal to decouple adapters from any
 * specific HTTP framework (Express, Hono, Node http, etc.).
 */
export interface IncomingRequest {
  /** HTTP method. */
  method: string;

  /** Request URL or path. */
  url: string;

  /** Request headers as a record of lowercase header names to values. */
  headers: Record<string, string | string[] | undefined>;

  /** Request body (may be undefined for GET requests). */
  body?: unknown;
}

// ---------------------------------------------------------------------------
// PaymentAdapter Interface
// ---------------------------------------------------------------------------

/**
 * The core adapter interface that all payment methods must implement.
 *
 * Adapters are the pluggable payment rails of OpenAgentPay. Each
 * adapter knows how to detect, verify, execute, and describe one
 * payment method (e.g. x402 stablecoins, prepaid credits, mock).
 *
 * The adapter pattern allows:
 * - Starting with mock payments for development
 * - Adding real payment methods without changing application code
 * - Supporting multiple payment methods simultaneously
 * - Future-proofing for new payment rails
 *
 * @example
 * ```typescript
 * const adapter: PaymentAdapter = {
 *   type: 'mock',
 *   detect: (req) => !!req.headers['x-payment']?.startsWith('mock:'),
 *   verify: async (req, pricing) => ({ valid: true }),
 *   describeMethod: (config) => ({ type: 'x402', ... }),
 *   pay: async (method, pricing) => ({ header: 'X-PAYMENT', value: 'mock:abc' }),
 *   supports: (method) => true,
 * };
 * ```
 */
export interface PaymentAdapter {
  /** Unique adapter type identifier (e.g. `"x402"`, `"credits"`, `"mock"`). */
  readonly type: string;

  // --- Server-side methods ---

  /**
   * Detect whether this request carries a payment for this adapter.
   *
   * Called by the paywall middleware to determine which adapter
   * should handle the incoming request.
   */
  detect(req: IncomingRequest): boolean;

  /**
   * Verify that the payment proof is valid and the amount is sufficient.
   *
   * Called after `detect` returns `true`. Should validate cryptographic
   * proofs, check amounts, and return partial receipt data on success.
   */
  verify(req: IncomingRequest, pricing: Pricing): Promise<VerifyResult>;

  /**
   * Generate the payment method block for inclusion in the 402 response.
   *
   * Called when building the PaymentRequired response body. The returned
   * method tells agents how to pay using this adapter.
   */
  describeMethod(config: AdapterConfig): PaymentMethod;

  // --- Client-side methods ---

  /**
   * Execute a payment and return the proof to attach to the retry request.
   *
   * Called by the client SDK after policy approval. The returned proof
   * is sent as an HTTP header on the subsequent request.
   */
  pay(method: PaymentMethod, pricing: Pricing): Promise<PaymentProof>;

  /**
   * Check whether this adapter can handle the given payment method.
   *
   * Called by the client SDK to match available adapters to the
   * payment methods advertised in the 402 response.
   */
  supports(method: PaymentMethod): boolean;
}
