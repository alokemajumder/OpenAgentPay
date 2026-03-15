/**
 * @module memory-store
 *
 * In-memory implementation of {@link ReceiptStore}.
 * Stores receipts in a Map for fast ID lookups and an array for ordered queries.
 */

import type { AgentPaymentReceipt } from "@openagentpay/core";
import type {
  ReceiptStore,
  ReceiptQuery,
  ReceiptQueryResult,
  ReceiptSummary,
  ReceiptSummaryQuery,
  ReceiptExportParams,
} from "./types.js";
import { filterAndQuery, computeSummary, matchesFilter } from "./query.js";
import { exportJSON, exportCSV } from "./export.js";

/**
 * In-memory receipt store backed by a `Map`.
 *
 * Suitable for development, testing, and short-lived agent sessions.
 * All data is lost when the process exits.
 */
export class InMemoryReceiptStore implements ReceiptStore {
  private readonly receipts = new Map<string, AgentPaymentReceipt>();

  async save(receipt: AgentPaymentReceipt): Promise<void> {
    // Idempotent: overwrite if same ID exists
    this.receipts.set(receipt.id, receipt);
  }

  async get(id: string): Promise<AgentPaymentReceipt | null> {
    return this.receipts.get(id) ?? null;
  }

  async query(params: ReceiptQuery): Promise<ReceiptQueryResult> {
    const all = Array.from(this.receipts.values());
    return filterAndQuery(all, params);
  }

  async summary(params?: ReceiptSummaryQuery): Promise<ReceiptSummary> {
    const all = Array.from(this.receipts.values());
    return computeSummary(all, params);
  }

  async export(params: ReceiptExportParams): Promise<string> {
    // If query filters are provided, apply them first (no pagination for export)
    let receipts: AgentPaymentReceipt[];
    if (params.query) {
      const all = Array.from(this.receipts.values());
      receipts = all.filter((r) => matchesFilter(r, params.query!));
      // Sort by timestamp descending by default
      const order = params.query.order ?? "desc";
      receipts.sort((a, b) => {
        const ta = new Date(a.timestamp).getTime();
        const tb = new Date(b.timestamp).getTime();
        return order === "asc" ? ta - tb : tb - ta;
      });
    } else {
      receipts = Array.from(this.receipts.values());
    }

    switch (params.format) {
      case "json":
        return exportJSON(receipts);
      case "csv":
        return exportCSV(receipts);
      default:
        throw new Error(`Unsupported export format: ${params.format as string}`);
    }
  }

  async count(params?: ReceiptQuery): Promise<number> {
    if (!params) {
      return this.receipts.size;
    }
    const all = Array.from(this.receipts.values());
    return all.filter((r) => matchesFilter(r, params)).length;
  }

  async delete(id: string): Promise<boolean> {
    return this.receipts.delete(id);
  }
}
