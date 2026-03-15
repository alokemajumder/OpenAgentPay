/**
 * @module export
 *
 * Export receipts to JSON and CSV formats.
 */

import type { AgentPaymentReceipt } from "@openagentpay/core";

// ---------------------------------------------------------------------------
// JSON export
// ---------------------------------------------------------------------------

/**
 * Export an array of receipts as pretty-printed JSON.
 */
export function exportJSON(receipts: AgentPaymentReceipt[]): string {
  return JSON.stringify(receipts, null, 2);
}

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

/** CSV column headers. */
const CSV_HEADERS = [
  "id",
  "timestamp",
  "payer",
  "payee",
  "endpoint",
  "amount",
  "currency",
  "method",
  "status",
  "transaction_hash",
  "latency_ms",
  "task_id",
] as const;

/**
 * Escape a CSV field value. Wraps in double-quotes if the value contains
 * a comma, double-quote, or newline. Internal double-quotes are doubled.
 */
function escapeCSV(value: string): string {
  if (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Convert a single receipt to a CSV row (array of string values).
 */
function receiptToRow(receipt: AgentPaymentReceipt): string[] {
  return [
    receipt.id,
    receipt.timestamp,
    receipt.payer.identifier,
    receipt.payee.identifier,
    receipt.payee.endpoint,
    receipt.payment.amount,
    receipt.payment.currency,
    receipt.payment.method,
    receipt.payment.status,
    receipt.payment.transaction_hash ?? "",
    String(receipt.response.latency_ms),
    receipt.request.task_id ?? "",
  ];
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

/**
 * Export an array of receipts as a CSV string with headers.
 */
export function exportCSV(receipts: AgentPaymentReceipt[]): string {
  const header = CSV_HEADERS.map(escapeCSV).join(",");
  const rows = receipts.map((r) =>
    receiptToRow(r).map(escapeCSV).join(","),
  );
  return [header, ...rows].join("\n");
}
