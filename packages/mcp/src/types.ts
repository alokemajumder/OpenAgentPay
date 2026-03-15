/**
 * @module types
 *
 * Types for the OpenAgentPay MCP integration.
 *
 * These types define the protocol-level payment signaling mechanism
 * for MCP (Model Context Protocol) tools. Payment requirements and
 * proofs are embedded in tool parameters and results, enabling paid
 * tools without any MCP SDK dependency.
 *
 * @packageDocumentation
 */

import type {
  PaymentRequired,
  PaymentAdapter,
  PaymentMethod,
  PaymentProof,
  Pricing,
  AgentPaymentReceipt,
  SubscriptionPlan,
} from "@openagentpay/core";

// ---------------------------------------------------------------------------
// Server-Side: Paid Tool Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for a paid MCP tool.
 *
 * Defines the pricing, accepted payment methods, and recipient for
 * a tool that charges per invocation. Pass this to `paidTool()` to
 * wrap a tool handler with automatic payment verification.
 *
 * @example
 * ```typescript
 * const config: PaidToolConfig = {
 *   price: '0.01',
 *   currency: 'USDC',
 *   description: 'Premium AI-powered search',
 *   adapters: [mockAdapter],
 *   recipient: '0x1234...',
 * };
 * ```
 */
export interface PaidToolConfig {
  /** Price per invocation as a decimal string (e.g. `"0.01"`). */
  price: string;

  /** Currency code or token symbol. Default: `"USDC"`. */
  currency?: string;

  /** Human-readable description of what the tool does. */
  description?: string;

  /** Payment adapters that this tool accepts. */
  adapters: PaymentAdapter[];

  /** Recipient wallet address that will receive payments. */
  recipient: string;

  /** Optional subscription plans offered as alternatives to per-call pricing. */
  subscriptions?: SubscriptionPlan[];
}

// ---------------------------------------------------------------------------
// Payment Signaling in MCP Tool Results
// ---------------------------------------------------------------------------

/**
 * Payment requirement embedded in an MCP tool result.
 *
 * When a tool is invoked without payment, the `paidTool` wrapper
 * returns this object instead of the actual tool result. The client
 * can detect it via the `__openagentpay: true` sentinel and parse
 * the `paymentRequired` field to discover pricing and payment methods.
 *
 * This is the MCP equivalent of an HTTP 402 Payment Required response.
 */
export interface ToolPaymentRequired {
  /** Sentinel field — always `true`. Used to detect payment requirements in tool results. */
  __openagentpay: true;

  /** The full payment requirement, identical to an HTTP 402 response body. */
  paymentRequired: PaymentRequired;
}

// ---------------------------------------------------------------------------
// Payment Proof in MCP Tool Parameters
// ---------------------------------------------------------------------------

/**
 * Payment proof attached to MCP tool parameters.
 *
 * When the client has made a payment, it retries the tool call with
 * this field added to the parameters. The server extracts the proof,
 * verifies it via the adapter, and runs the tool if valid.
 *
 * The proof mirrors the HTTP header mechanism used in the REST flow:
 * the `header` field names the header (e.g. `"X-PAYMENT"`) and the
 * `value` field contains the proof payload.
 */
export interface ToolPaymentProof {
  __openagentpay_payment: {
    /** Header name (e.g. `"X-PAYMENT"`). */
    header: string;

    /** Header value containing the payment proof. */
    value: string;
  };
}

// ---------------------------------------------------------------------------
// Client-Side: MCP Payment Configuration
// ---------------------------------------------------------------------------

/**
 * Wallet adapter interface for MCP payment clients.
 *
 * A wallet knows how to execute payments for one or more payment
 * methods and return a proof that the server can verify.
 */
export interface WalletAdapter {
  /**
   * Execute a payment and return the proof.
   *
   * @param method - The payment method selected from the payment requirement.
   * @param pricing - The pricing information for this tool call.
   * @returns A payment proof containing the header name and value.
   */
  pay(method: PaymentMethod, pricing: Pricing): Promise<PaymentProof>;

  /**
   * Check whether this wallet can handle the given payment method.
   *
   * @param method - A payment method from the payment requirement.
   * @returns `true` if this wallet can pay using this method.
   */
  supports(method: PaymentMethod): boolean;
}

/**
 * Configuration for the MCP payment client wrapper.
 *
 * Pass this to `withMCPPayment()` to create a payment-aware MCP client
 * that transparently handles paid tools.
 *
 * @example
 * ```typescript
 * const config: MCPPaymentConfig = {
 *   wallet: myWallet,
 *   policy: {
 *     maxPerCall: '0.10',
 *     maxPerDay: '5.00',
 *     allowedTools: ['premium-search', 'translate'],
 *   },
 *   onReceipt: (receipt) => console.log('Paid:', receipt.payment.amount),
 * };
 * ```
 */
export interface MCPPaymentConfig {
  /** Wallet adapter for making payments. */
  wallet: WalletAdapter;

  /**
   * Spend policy for autonomous tool payments.
   *
   * Prevents runaway costs by constraining what the agent can spend.
   * All monetary amounts are decimal strings for precision.
   */
  policy?: {
    /** Maximum amount allowed for a single tool call. */
    maxPerCall?: string;

    /** Maximum total spend in a rolling 24-hour window. */
    maxPerDay?: string;

    /** Allowlist of tool names. If set, only these tools can be paid for. */
    allowedTools?: string[];
  };

  /**
   * Called after every successful paid tool call with the structured receipt.
   * Use this for logging, cost attribution, or analytics.
   */
  onReceipt?: (receipt: AgentPaymentReceipt) => void;
}

// ---------------------------------------------------------------------------
// Utility Types
// ---------------------------------------------------------------------------

/**
 * Information about a tool's payment status and pricing.
 *
 * Returned by utility functions that inspect tool results for
 * payment requirements.
 */
export interface ToolPaymentInfo {
  /** Whether the tool result contains a payment requirement. */
  requiresPayment: boolean;

  /** The payment requirement, if present. */
  paymentRequired?: PaymentRequired;

  /** Price per call as a decimal string. */
  price?: string;

  /** Currency code. */
  currency?: string;

  /** Available payment method types. */
  methods?: string[];
}
