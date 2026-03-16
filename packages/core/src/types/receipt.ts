/**
 * @module receipt
 *
 * Types for the AgentPaymentReceipt standard.
 * Every agent payment generates a structured, verifiable receipt
 * enabling cost attribution, compliance auditing, dispute resolution,
 * and agent performance analytics.
 */

// ---------------------------------------------------------------------------
// Payer
// ---------------------------------------------------------------------------

/**
 * Identifies who made the payment.
 */
export interface Payer {
  /** Whether the payer is an autonomous agent or a service. */
  type: "agent" | "service";

  /** Wallet address or credit account identifier. */
  identifier: string;

  /** Optional agent identity for multi-agent systems. */
  agent_id?: string;

  /** Organization the agent belongs to, for cost attribution. */
  organization_id?: string;
}

// ---------------------------------------------------------------------------
// Payee
// ---------------------------------------------------------------------------

/**
 * Identifies who received the payment.
 */
export interface Payee {
  /** Provider name or unique identifier. */
  provider_id?: string;

  /** Wallet address that received the payment. */
  identifier: string;

  /** The API endpoint that was called. */
  endpoint: string;
}

// ---------------------------------------------------------------------------
// Request Summary
// ---------------------------------------------------------------------------

/**
 * Summary of the original HTTP request, included in the receipt
 * for auditability without exposing request body contents.
 */
export interface RequestSummary {
  /** HTTP method (e.g. `"GET"`, `"POST"`). */
  method: string;

  /** Full request URL. */
  url: string;

  /** SHA-256 hash of the request body — verifiable without exposing data. */
  body_hash?: string;

  /** MCP tool name, if the call was made via MCP. */
  tool_name?: string;

  /** Workflow or task identifier for cost attribution. */
  task_id?: string;

  /** Session identifier for grouping related calls. */
  session_id?: string;
}

// ---------------------------------------------------------------------------
// Payment Details
// ---------------------------------------------------------------------------

/**
 * Details about how the payment was executed and its settlement status.
 */
export interface PaymentDetails {
  /** Amount paid as a decimal string (e.g. `"0.01"`). */
  amount: string;

  /** Currency code or token symbol. */
  currency: string;

  /** Which payment adapter processed this payment. */
  method: "x402" | "credits" | "mock" | "stripe" | "paypal" | "upi";

  /** On-chain transaction hash (present for x402 payments). */
  transaction_hash?: string;

  /** Blockchain network (present for x402 payments). */
  network?: string;

  /** Settlement status of the payment. */
  status: "settled" | "pending" | "failed";
}

// ---------------------------------------------------------------------------
// Response Summary
// ---------------------------------------------------------------------------

/**
 * Summary of the API response, proving what was delivered in exchange
 * for the payment. The content hash enables non-repudiation.
 */
export interface ResponseSummary {
  /** HTTP status code of the response (e.g. `200`). */
  status_code: number;

  /** SHA-256 hash of the response body. */
  content_hash: string;

  /** Response body size in bytes. */
  content_length: number;

  /** Response latency in milliseconds. */
  latency_ms: number;
}

// ---------------------------------------------------------------------------
// Policy Decision
// ---------------------------------------------------------------------------

/**
 * Record of the agent's policy engine decision for this payment.
 * Provides an audit trail of why the payment was approved.
 */
export interface PolicyDecision {
  /** How the payment was approved. */
  decision: "auto_approved" | "manual_approved" | "budget_checked";

  /** Names of the policy rules that were evaluated. */
  rules_evaluated: string[];

  /** Remaining budget after this payment (decimal string). */
  budget_remaining?: string;
}

// ---------------------------------------------------------------------------
// AgentPaymentReceipt
// ---------------------------------------------------------------------------

/**
 * A structured, verifiable receipt generated for every agent payment.
 *
 * Receipts are the backbone of the OpenAgentPay audit trail. They
 * enable enterprise cost attribution, compliance auditing, dispute
 * resolution, and agent performance analytics.
 *
 * @example
 * ```json
 * {
 *   "id": "01HX3KQVR8...",
 *   "version": "1.0",
 *   "timestamp": "2026-03-15T12:00:00.000Z",
 *   "payer": { "type": "agent", "identifier": "0xabc..." },
 *   "payee": { "identifier": "0x123...", "endpoint": "/api/search" },
 *   "request": { "method": "GET", "url": "https://api.example.com/search" },
 *   "payment": { "amount": "0.01", "currency": "USDC", "method": "x402", "status": "settled" },
 *   "response": { "status_code": 200, "content_hash": "sha256:...", "content_length": 1024, "latency_ms": 120 }
 * }
 * ```
 */
export interface AgentPaymentReceipt {
  /** Unique receipt identifier (ULID — sortable, timestamp-embedded). */
  id: string;

  /** Schema version — currently `"1.0"`. */
  version: "1.0";

  /** ISO 8601 timestamp of when the payment occurred. */
  timestamp: string;

  /** Who paid. */
  payer: Payer;

  /** Who was paid. */
  payee: Payee;

  /** Summary of the original request. */
  request: RequestSummary;

  /** Payment execution details. */
  payment: PaymentDetails;

  /** Summary of the response delivered. */
  response: ResponseSummary;

  /** Policy engine decision log (from the agent's policy engine). */
  policy?: PolicyDecision;

  /** Optional cryptographic signature for non-repudiation. */
  signature?: string;
}
