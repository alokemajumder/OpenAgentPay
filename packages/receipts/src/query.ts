/**
 * @module query
 *
 * Query engine: filters, sorts, and paginates receipts in memory.
 * Used by both InMemoryReceiptStore and FileReceiptStore.
 */

import type { AgentPaymentReceipt } from "@openagentpay/core";
import type { ReceiptQuery, ReceiptQueryResult, ReceiptSummary, ReceiptSummaryQuery } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compare two decimal strings numerically.
 * Returns negative if a < b, zero if equal, positive if a > b.
 */
function compareDecimal(a: string, b: string): number {
  const na = parseFloat(a);
  const nb = parseFloat(b);
  return na - nb;
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/**
 * Returns true if the receipt matches all filters in the query.
 */
export function matchesFilter(
  receipt: AgentPaymentReceipt,
  query: Omit<ReceiptQuery, "limit" | "offset" | "order">,
): boolean {
  if (query.payer && receipt.payer.identifier !== query.payer) {
    return false;
  }

  if (query.payee && receipt.payee.identifier !== query.payee) {
    return false;
  }

  if (query.method && receipt.payment.method !== query.method) {
    return false;
  }

  if (query.currency && receipt.payment.currency !== query.currency) {
    return false;
  }

  if (query.taskId && receipt.request.task_id !== query.taskId) {
    return false;
  }

  if (query.sessionId && receipt.request.session_id !== query.sessionId) {
    return false;
  }

  if (query.after) {
    const receiptTime = new Date(receipt.timestamp).getTime();
    const afterTime = new Date(query.after).getTime();
    if (receiptTime <= afterTime) return false;
  }

  if (query.before) {
    const receiptTime = new Date(receipt.timestamp).getTime();
    const beforeTime = new Date(query.before).getTime();
    if (receiptTime >= beforeTime) return false;
  }

  if (query.minAmount) {
    if (compareDecimal(receipt.payment.amount, query.minAmount) < 0) {
      return false;
    }
  }

  if (query.maxAmount) {
    if (compareDecimal(receipt.payment.amount, query.maxAmount) > 0) {
      return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Sort + Paginate
// ---------------------------------------------------------------------------

/**
 * Sorts receipts by timestamp and applies limit/offset pagination.
 */
export function sortAndPaginate(
  receipts: AgentPaymentReceipt[],
  query: ReceiptQuery,
): ReceiptQueryResult {
  const order = query.order ?? "desc";
  const limit = query.limit ?? 100;
  const offset = query.offset ?? 0;

  // Sort by timestamp
  const sorted = [...receipts].sort((a, b) => {
    const ta = new Date(a.timestamp).getTime();
    const tb = new Date(b.timestamp).getTime();
    return order === "asc" ? ta - tb : tb - ta;
  });

  const total = sorted.length;
  const page = sorted.slice(offset, offset + limit);

  return { receipts: page, total, limit, offset };
}

// ---------------------------------------------------------------------------
// Filter + Query (combined)
// ---------------------------------------------------------------------------

/**
 * Filters an array of receipts by query parameters, then sorts and paginates.
 */
export function filterAndQuery(
  receipts: AgentPaymentReceipt[],
  query: ReceiptQuery,
): ReceiptQueryResult {
  const filtered = receipts.filter((r) => matchesFilter(r, query));
  return sortAndPaginate(filtered, query);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/**
 * Computes an aggregate summary over the given receipts.
 * If `params` is provided, only matching receipts are included.
 */
export function computeSummary(
  receipts: AgentPaymentReceipt[],
  params?: ReceiptSummaryQuery,
): ReceiptSummary {
  const filtered = params
    ? receipts.filter((r) => matchesFilter(r, params))
    : receipts;

  let totalAmount = 0;
  let currency = "";
  let earliest: string | null = null;
  let latest: string | null = null;

  const byMethod: Record<string, { count: number; amount: number }> = {};
  const byProvider: Record<string, { count: number; amount: number }> = {};

  for (const r of filtered) {
    const amount = parseFloat(r.payment.amount);
    totalAmount += amount;

    // Use the first receipt's currency as the summary currency
    if (!currency) {
      currency = r.payment.currency;
    }

    // Date range tracking
    if (earliest === null || r.timestamp < earliest) {
      earliest = r.timestamp;
    }
    if (latest === null || r.timestamp > latest) {
      latest = r.timestamp;
    }

    // By method
    const method = r.payment.method;
    if (!byMethod[method]) {
      byMethod[method] = { count: 0, amount: 0 };
    }
    byMethod[method].count += 1;
    byMethod[method].amount += amount;

    // By provider (use payee identifier as key)
    const provider = r.payee.provider_id ?? r.payee.identifier;
    if (!byProvider[provider]) {
      byProvider[provider] = { count: 0, amount: 0 };
    }
    byProvider[provider].count += 1;
    byProvider[provider].amount += amount;
  }

  // Convert numeric amounts back to strings
  const byMethodStr: Record<string, { count: number; amount: string }> = {};
  for (const [k, v] of Object.entries(byMethod)) {
    byMethodStr[k] = { count: v.count, amount: v.amount.toFixed(6) };
  }

  const byProviderStr: Record<string, { count: number; amount: string }> = {};
  for (const [k, v] of Object.entries(byProvider)) {
    byProviderStr[k] = { count: v.count, amount: v.amount.toFixed(6) };
  }

  return {
    totalCount: filtered.length,
    totalAmount: totalAmount.toFixed(6),
    currency: currency || "USDC",
    byMethod: byMethodStr,
    byProvider: byProviderStr,
    dateRange:
      earliest && latest ? { earliest, latest } : null,
  };
}
