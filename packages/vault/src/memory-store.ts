/**
 * @module memory-store
 *
 * In-memory implementation of the {@link VaultStore} interface.
 * Suitable for development, testing, and short-lived processes.
 * Data is lost when the process exits.
 */

import type { VaultEntry, VaultStore } from './types.js';

/**
 * Simple Map-based credential store for development and testing.
 *
 * All data lives in process memory and is not persisted to disk.
 *
 * @example
 * ```typescript
 * const store = new InMemoryVaultStore();
 * await store.store(entry);
 * const retrieved = await store.retrieve(entry.id);
 * ```
 */
export class InMemoryVaultStore implements VaultStore {
  private readonly entries = new Map<string, VaultEntry>();

  /** Persist a credential entry. Overwrites any existing entry with the same ID. */
  async store(entry: VaultEntry): Promise<void> {
    // Deep-clone to prevent external mutation
    this.entries.set(entry.id, JSON.parse(JSON.stringify(entry)));
  }

  /** Retrieve a credential by its unique ID, or `null` if not found. */
  async retrieve(id: string): Promise<VaultEntry | null> {
    const entry = this.entries.get(id);
    return entry ? JSON.parse(JSON.stringify(entry)) : null;
  }

  /** Retrieve all credentials belonging to an agent. */
  async retrieveByAgent(agentId: string): Promise<VaultEntry[]> {
    const results: VaultEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.agentId === agentId) {
        results.push(JSON.parse(JSON.stringify(entry)));
      }
    }
    return results;
  }

  /** Retrieve the active credential for an agent + protocol combination, or `null`. */
  async retrieveByProtocol(agentId: string, protocol: string): Promise<VaultEntry | null> {
    for (const entry of this.entries.values()) {
      if (entry.agentId === agentId && entry.protocol === protocol && entry.active) {
        return JSON.parse(JSON.stringify(entry));
      }
    }
    return null;
  }

  /** Apply partial updates to a credential entry. Throws if the entry does not exist. */
  async update(id: string, updates: Partial<VaultEntry>): Promise<void> {
    const existing = this.entries.get(id);
    if (!existing) {
      throw new Error(`VaultEntry not found: ${id}`);
    }
    // Merge updates (shallow merge is sufficient — VaultEntry fields are flat)
    Object.assign(existing, updates);
  }

  /** Revoke (deactivate) a credential by ID. No-op if the entry does not exist. */
  async revoke(id: string): Promise<void> {
    const existing = this.entries.get(id);
    if (existing) {
      existing.active = false;
    }
  }

  /** List all active credentials for an agent. */
  async listActive(agentId: string): Promise<VaultEntry[]> {
    const results: VaultEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.agentId === agentId && entry.active) {
        results.push(JSON.parse(JSON.stringify(entry)));
      }
    }
    return results;
  }

  /** Remove expired entries from the store. Returns the number of entries removed. */
  async cleanup(): Promise<number> {
    const now = Date.now();
    let removed = 0;
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= now) {
        this.entries.delete(id);
        removed++;
      }
    }
    return removed;
  }
}
