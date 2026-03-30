/**
 * @module kv-receipt-store
 *
 * KV-backed receipt storage for Cloudflare Workers.
 * Stores AgentPaymentReceipts in a Cloudflare KV namespace with
 * prefix-based namespacing and optional TTL for automatic cleanup.
 */

import type { AgentPaymentReceipt } from '@openagentpay/core';
import type {
  KVNamespaceLike,
  ReceiptQueryFilter,
  ReceiptQueryResult,
} from './types.js';

/** Default key prefix for receipt entries. */
const KEY_PREFIX = 'receipt:';

/** Default TTL: 30 days in seconds. */
const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Options for constructing a KVReceiptStore.
 */
export interface KVReceiptStoreOptions {
  /** The KV namespace binding. */
  kv: KVNamespaceLike;

  /**
   * TTL in seconds for receipt entries.
   * Set to `0` or `undefined` to disable automatic expiration.
   * @default 2592000 (30 days)
   */
  ttlSeconds?: number;

  /**
   * Key prefix for namespacing receipt entries within the KV namespace.
   * @default "receipt:"
   */
  keyPrefix?: string;
}

/**
 * Stores and retrieves payment receipts using Cloudflare KV.
 *
 * Keys are structured as `{prefix}{id}` where the default prefix is `receipt:`.
 * An additional index key `{prefix}idx:{timestamp}:{id}` is written to enable
 * chronological listing via KV's `list()` with prefix scanning.
 *
 * @example
 * ```ts
 * const store = new KVReceiptStore({ kv: env.RECEIPT_KV });
 * await store.store(receipt);
 * const retrieved = await store.get(receipt.id);
 * ```
 */
export class KVReceiptStore {
  private readonly kv: KVNamespaceLike;
  private readonly ttlSeconds: number | undefined;
  private readonly keyPrefix: string;

  constructor(options: KVReceiptStoreOptions) {
    this.kv = options.kv;
    this.ttlSeconds = options.ttlSeconds === 0 ? undefined : (options.ttlSeconds ?? DEFAULT_TTL_SECONDS);
    this.keyPrefix = options.keyPrefix ?? KEY_PREFIX;
  }

  /**
   * Persist a receipt. Idempotent on `receipt.id`.
   *
   * Writes two keys:
   * - `receipt:{id}` — the full receipt JSON
   * - `receipt:idx:{timestamp}:{id}` — a lightweight index entry for listing
   */
  async store(receipt: AgentPaymentReceipt): Promise<void> {
    const primaryKey = `${this.keyPrefix}${receipt.id}`;
    const indexKey = `${this.keyPrefix}idx:${receipt.timestamp}:${receipt.id}`;

    const json = JSON.stringify(receipt);
    const putOptions = this.ttlSeconds ? { expirationTtl: this.ttlSeconds } : undefined;

    // Write both keys in parallel
    await Promise.all([
      this.kv.put(primaryKey, json, putOptions),
      this.kv.put(indexKey, receipt.id, putOptions),
    ]);
  }

  /**
   * Retrieve a receipt by its unique ID, or `null` if not found.
   */
  async get(id: string): Promise<AgentPaymentReceipt | null> {
    const key = `${this.keyPrefix}${id}`;
    const value = await this.kv.get(key, { type: 'text' });
    if (!value) return null;

    try {
      return JSON.parse(value) as AgentPaymentReceipt;
    } catch {
      return null;
    }
  }

  /**
   * List receipts in chronological order (most recent first).
   *
   * Uses KV's prefix listing on index keys. Since KV lists keys in
   * lexicographic order and timestamps are ISO-8601 (lexicographically
   * sortable), results are naturally ordered.
   */
  async list(options?: {
    limit?: number;
    cursor?: string;
  }): Promise<{ receipts: AgentPaymentReceipt[]; cursor?: string }> {
    const limit = options?.limit ?? 50;
    const indexPrefix = `${this.keyPrefix}idx:`;

    const listResult = await this.kv.list({
      prefix: indexPrefix,
      limit,
      cursor: options?.cursor,
    });

    // Fetch full receipts for each index entry
    const receipts: AgentPaymentReceipt[] = [];
    for (const key of listResult.keys) {
      // Extract receipt ID from the index key: "receipt:idx:{timestamp}:{id}"
      const parts = key.name.slice(indexPrefix.length).split(':');
      // The ID is everything after the timestamp (timestamp is ISO-8601 with colons)
      // Format: "2026-03-15T12:00:00.000Z:01abc-def123"
      // We stored it as value, but KV list doesn't return values, so parse from key
      const id = await this.kv.get(key.name, { type: 'text' });
      if (id) {
        const receipt = await this.get(id);
        if (receipt) {
          receipts.push(receipt);
        }
      }
    }

    // Reverse to get most-recent-first
    receipts.reverse();

    return {
      receipts,
      cursor: listResult.list_complete ? undefined : listResult.cursor,
    };
  }

  /**
   * Query receipts with filtering.
   *
   * Note: Cloudflare KV is not a database — complex queries require
   * scanning entries. For high-volume use cases, consider pairing
   * this with Analytics Engine or D1.
   */
  async query(filter: ReceiptQueryFilter): Promise<ReceiptQueryResult> {
    const limit = filter.limit ?? 50;
    const indexPrefix = `${this.keyPrefix}idx:`;

    // Use 'after' timestamp as a prefix lower bound if provided
    const listPrefix = filter.after
      ? `${indexPrefix}${filter.after}`
      : indexPrefix;

    const listResult = await this.kv.list({
      prefix: listPrefix,
      // Fetch more than needed since we'll filter client-side
      limit: limit * 3,
      cursor: filter.cursor,
    });

    const receipts: AgentPaymentReceipt[] = [];

    for (const key of listResult.keys) {
      if (receipts.length >= limit) break;

      const id = await this.kv.get(key.name, { type: 'text' });
      if (!id) continue;

      const receipt = await this.get(id);
      if (!receipt) continue;

      // Apply filters
      if (filter.payerIdentifier && receipt.payer.identifier !== filter.payerIdentifier) {
        continue;
      }
      if (filter.method && receipt.payment.method !== filter.method) {
        continue;
      }
      if (filter.before && receipt.timestamp >= filter.before) {
        continue;
      }
      if (filter.after && receipt.timestamp <= filter.after) {
        continue;
      }

      receipts.push(receipt);
    }

    // Reverse to get most-recent-first
    receipts.reverse();

    return {
      receipts,
      cursor: listResult.list_complete ? undefined : listResult.cursor,
    };
  }
}
