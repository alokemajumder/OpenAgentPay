/**
 * @module types
 *
 * Interfaces for the receipt storage, query, and export system.
 */

import type { AgentPaymentReceipt } from "@openagentpay/core";

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/**
 * Filter and pagination parameters for querying receipts.
 */
export interface ReceiptQuery {
  /** Filter by payer identifier (wallet address, agent ID). */
  payer?: string;
  /** Filter by payee/provider endpoint. */
  payee?: string;
  /** Filter by payment method type ('x402', 'credits', 'mock'). */
  method?: string;
  /** Filter receipts created after this ISO 8601 timestamp. */
  after?: string;
  /** Filter receipts created before this ISO 8601 timestamp. */
  before?: string;
  /** Filter by minimum amount (inclusive, decimal string). */
  minAmount?: string;
  /** Filter by maximum amount (inclusive, decimal string). */
  maxAmount?: string;
  /** Filter by currency code or token symbol. */
  currency?: string;
  /** Filter by task ID for cost attribution. */
  taskId?: string;
  /** Filter by session ID for grouping related calls. */
  sessionId?: string;
  /** Maximum number of results to return. Default 100. */
  limit?: number;
  /** Number of results to skip. Default 0. */
  offset?: number;
  /** Sort order by timestamp. Default 'desc' (newest first). */
  order?: "asc" | "desc";
}

/**
 * Paginated result set from a receipt query.
 */
export interface ReceiptQueryResult {
  /** Matching receipts for the current page. */
  receipts: AgentPaymentReceipt[];
  /** Total number of matching receipts (ignoring limit/offset). */
  total: number;
  /** The limit that was applied. */
  limit: number;
  /** The offset that was applied. */
  offset: number;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/**
 * Optional filters for computing a receipt summary.
 * Reuses the same filter fields as ReceiptQuery (minus pagination).
 */
export type ReceiptSummaryQuery = Omit<
  ReceiptQuery,
  "limit" | "offset" | "order"
>;

/**
 * Aggregate summary of receipts matching a query.
 */
export interface ReceiptSummary {
  /** Total number of matching receipts. */
  totalCount: number;
  /** Total amount spent (decimal string). */
  totalAmount: string;
  /** Currency of the totals. */
  currency: string;
  /** Breakdown by payment method. */
  byMethod: Record<string, { count: number; amount: string }>;
  /** Breakdown by provider/payee. */
  byProvider: Record<string, { count: number; amount: string }>;
  /** Date range of the matching receipts, or null if none. */
  dateRange: { earliest: string; latest: string } | null;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** Supported export formats. */
export type ExportFormat = "json" | "csv";

/**
 * Parameters for exporting receipts.
 */
export interface ReceiptExportParams {
  /** Output format. */
  format: ExportFormat;
  /** Optional query filters to select which receipts to export. */
  query?: ReceiptQuery;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * The ReceiptStore interface — the core abstraction for receipt persistence.
 *
 * Implementations must be idempotent on `save` (keyed by `receipt.id`).
 */
export interface ReceiptStore {
  /** Save a receipt. Idempotent on receipt.id. */
  save(receipt: AgentPaymentReceipt): Promise<void>;

  /** Get a receipt by ID. Returns null if not found. */
  get(id: string): Promise<AgentPaymentReceipt | null>;

  /** Query receipts with filters and pagination. */
  query(params: ReceiptQuery): Promise<ReceiptQueryResult>;

  /** Get aggregate summary (total spent, count, by provider, by method). */
  summary(params?: ReceiptSummaryQuery): Promise<ReceiptSummary>;

  /** Export receipts to a format (JSON or CSV). */
  export(params: ReceiptExportParams): Promise<string>;

  /** Count total receipts matching optional filter. */
  count(params?: ReceiptQuery): Promise<number>;

  /** Delete a receipt by ID. Returns true if deleted. */
  delete(id: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Factory config
// ---------------------------------------------------------------------------

/**
 * Configuration for {@link createReceiptStore}.
 */
export interface ReceiptStoreConfig {
  /** Storage backend type. Default: 'memory'. */
  type?: "memory" | "file";
  /** Directory path for file store. Default: './receipts'. */
  path?: string;
}
