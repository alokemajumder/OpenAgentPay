/**
 * @openagentpay/receipts
 *
 * Receipt storage, query, and export system for OpenAgentPay.
 * Every agent payment generates a structured receipt; this package
 * stores, queries, summarizes, and exports them.
 *
 * @example
 * ```ts
 * import { createReceiptStore } from '@openagentpay/receipts';
 *
 * // In-memory store (default)
 * const store = createReceiptStore();
 *
 * // File-backed store
 * const fileStore = createReceiptStore({ type: 'file', path: './data/receipts' });
 *
 * await store.save(receipt);
 * const result = await store.query({ payer: '0xabc...', limit: 10 });
 * const csv = await store.export({ format: 'csv' });
 * ```
 *
 * @packageDocumentation
 */

// Types
export type {
  ReceiptStore,
  ReceiptQuery,
  ReceiptQueryResult,
  ReceiptSummary,
  ReceiptSummaryQuery,
  ReceiptExportParams,
  ReceiptStoreConfig,
  ExportFormat,
} from "./types.js";

// Implementations
export { InMemoryReceiptStore } from "./memory-store.js";
export { FileReceiptStore } from "./file-store.js";

// Query utilities
export { matchesFilter, filterAndQuery, computeSummary } from "./query.js";

// Export utilities
export { exportJSON, exportCSV } from "./export.js";

// Store config type
import type { ReceiptStoreConfig } from "./types.js";
import { InMemoryReceiptStore } from "./memory-store.js";
import { FileReceiptStore } from "./file-store.js";

/**
 * Factory function to create a receipt store.
 *
 * @param config - Optional configuration. Defaults to in-memory store.
 * @returns A configured {@link ReceiptStore} instance.
 *
 * @example
 * ```ts
 * // Memory store (default)
 * const store = createReceiptStore();
 *
 * // File store with custom path
 * const fileStore = createReceiptStore({ type: 'file', path: './my-receipts' });
 * ```
 */
export function createReceiptStore(config?: ReceiptStoreConfig) {
  const type = config?.type ?? "memory";

  switch (type) {
    case "memory":
      return new InMemoryReceiptStore();
    case "file":
      return new FileReceiptStore(config?.path ?? "./receipts");
    default:
      throw new Error(`Unknown receipt store type: ${type as string}`);
  }
}
