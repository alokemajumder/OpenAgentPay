/**
 * @module builders/receipt
 *
 * Builder for constructing AgentPaymentReceipt objects.
 *
 * Automatically generates a ULID-based receipt ID and ISO timestamp.
 */

import type {
  AgentPaymentReceipt,
  Payer,
  Payee,
  RequestSummary,
  PaymentDetails,
  ResponseSummary,
  PolicyDecision,
} from "../types/receipt.js";
import { ulid } from "../utils/ulid.js";

// ---------------------------------------------------------------------------
// Builder Config
// ---------------------------------------------------------------------------

/**
 * Configuration for building a payment receipt.
 *
 * The `id` and `timestamp` fields are auto-generated if not provided.
 */
export interface BuildReceiptConfig {
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

  /** Policy engine decision log (optional). */
  policy?: PolicyDecision;

  /** Optional cryptographic signature. */
  signature?: string;

  /**
   * Override the auto-generated receipt ID.
   * If not provided, a ULID is generated automatically.
   */
  id?: string;

  /**
   * Override the auto-generated timestamp.
   * If not provided, the current time is used (ISO 8601).
   */
  timestamp?: string;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build an `AgentPaymentReceipt` with auto-generated ID and timestamp.
 *
 * The receipt ID is a ULID (Universally Unique Lexicographically Sortable
 * Identifier), which embeds a millisecond timestamp and is sortable.
 * The timestamp is an ISO 8601 string.
 *
 * @param config - The payment, request, response, and policy data.
 * @returns A fully populated `AgentPaymentReceipt`.
 *
 * @example
 * ```typescript
 * const receipt = buildReceipt({
 *   payer: { type: 'agent', identifier: '0xabc...' },
 *   payee: { identifier: '0x123...', endpoint: '/api/search' },
 *   request: { method: 'GET', url: 'https://api.example.com/search' },
 *   payment: { amount: '0.01', currency: 'USDC', method: 'x402', status: 'settled' },
 *   response: { status_code: 200, content_hash: 'sha256:...', content_length: 1024, latency_ms: 120 },
 * });
 *
 * console.log(receipt.id);        // "01HX3KQVR8..."
 * console.log(receipt.timestamp); // "2026-03-15T12:00:00.000Z"
 * ```
 */
export function buildReceipt(
  config: BuildReceiptConfig,
): AgentPaymentReceipt {
  const receipt: AgentPaymentReceipt = {
    id: config.id ?? ulid(),
    version: "1.0",
    timestamp: config.timestamp ?? new Date().toISOString(),
    payer: config.payer,
    payee: config.payee,
    request: config.request,
    payment: config.payment,
    response: config.response,
  };

  if (config.policy) {
    receipt.policy = config.policy;
  }

  if (config.signature) {
    receipt.signature = config.signature;
  }

  return receipt;
}
