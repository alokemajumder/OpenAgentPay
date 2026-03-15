/**
 * @module file-store
 *
 * File-system-backed implementation of {@link ReceiptStore}.
 * Each receipt is stored as a separate JSON file: `{dir}/{receipt.id}.json`.
 */

import { readdir, readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
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
 * File-system receipt store.
 *
 * Stores each receipt as `{directory}/{id}.json`. Auto-creates the
 * directory on first write. Suitable for single-process agents that
 * need persistent receipt storage without a database.
 */
export class FileReceiptStore implements ReceiptStore {
  private readonly dir: string;
  private dirCreated = false;

  constructor(directory: string = "./receipts") {
    this.dir = directory;
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  /** Ensure the storage directory exists. */
  private async ensureDir(): Promise<void> {
    if (this.dirCreated) return;
    await mkdir(this.dir, { recursive: true });
    this.dirCreated = true;
  }

  /** Full file path for a receipt ID. */
  private filePath(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  /** Read and parse a single receipt file. Returns null on any error. */
  private async readReceipt(
    filename: string,
  ): Promise<AgentPaymentReceipt | null> {
    try {
      const raw = await readFile(join(this.dir, filename), "utf-8");
      return JSON.parse(raw) as AgentPaymentReceipt;
    } catch {
      return null;
    }
  }

  /** Read all receipt files from the directory. */
  private async readAll(): Promise<AgentPaymentReceipt[]> {
    await this.ensureDir();
    let entries: string[];
    try {
      entries = await readdir(this.dir);
    } catch {
      return [];
    }

    const jsonFiles = entries.filter((f) => f.endsWith(".json"));
    const results: AgentPaymentReceipt[] = [];

    // Read files concurrently in batches to avoid opening too many handles
    const BATCH_SIZE = 50;
    for (let i = 0; i < jsonFiles.length; i += BATCH_SIZE) {
      const batch = jsonFiles.slice(i, i + BATCH_SIZE);
      const receipts = await Promise.all(batch.map((f) => this.readReceipt(f)));
      for (const r of receipts) {
        if (r) results.push(r);
      }
    }

    return results;
  }

  // -----------------------------------------------------------------------
  // ReceiptStore implementation
  // -----------------------------------------------------------------------

  async save(receipt: AgentPaymentReceipt): Promise<void> {
    await this.ensureDir();
    const data = JSON.stringify(receipt, null, 2);
    await writeFile(this.filePath(receipt.id), data, "utf-8");
  }

  async get(id: string): Promise<AgentPaymentReceipt | null> {
    try {
      const raw = await readFile(this.filePath(id), "utf-8");
      return JSON.parse(raw) as AgentPaymentReceipt;
    } catch {
      return null;
    }
  }

  async query(params: ReceiptQuery): Promise<ReceiptQueryResult> {
    const all = await this.readAll();
    return filterAndQuery(all, params);
  }

  async summary(params?: ReceiptSummaryQuery): Promise<ReceiptSummary> {
    const all = await this.readAll();
    return computeSummary(all, params);
  }

  async export(params: ReceiptExportParams): Promise<string> {
    let receipts: AgentPaymentReceipt[];
    if (params.query) {
      const all = await this.readAll();
      receipts = all.filter((r) => matchesFilter(r, params.query!));
      const order = params.query.order ?? "desc";
      receipts.sort((a, b) => {
        const ta = new Date(a.timestamp).getTime();
        const tb = new Date(b.timestamp).getTime();
        return order === "asc" ? ta - tb : tb - ta;
      });
    } else {
      receipts = await this.readAll();
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
    const all = await this.readAll();
    if (!params) return all.length;
    return all.filter((r) => matchesFilter(r, params)).length;
  }

  async delete(id: string): Promise<boolean> {
    try {
      await unlink(this.filePath(id));
      return true;
    } catch {
      return false;
    }
  }
}
