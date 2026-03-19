/**
 * @module vault
 *
 * The Vault class provides a high-level API for storing, retrieving,
 * and managing agent payment credentials across protocols.
 */

import { randomUUID } from 'node:crypto';

import type { VaultConfig, VaultEntry, VaultProtocol, VaultStore } from './types.js';
import { InMemoryVaultStore } from './memory-store.js';
import { EncryptedVaultStore } from './encrypted-store.js';

// ---------------------------------------------------------------------------
// Duration parsing
// ---------------------------------------------------------------------------

/** Parse a human-readable duration string into milliseconds. */
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)\s*(s|sec|second|seconds|m|min|minute|minutes|h|hr|hour|hours|d|day|days|w|week|weeks)$/i);
  if (!match) {
    throw new Error(`Invalid duration format: "${duration}". Use e.g. "30m", "24h", "7d", "1w".`);
  }

  const value = parseInt(match[1]!, 10);
  const unit = match[2]!.toLowerCase();

  switch (unit) {
    case 's':
    case 'sec':
    case 'second':
    case 'seconds':
      return value * 1_000;
    case 'm':
    case 'min':
    case 'minute':
    case 'minutes':
      return value * 60_000;
    case 'h':
    case 'hr':
    case 'hour':
    case 'hours':
      return value * 3_600_000;
    case 'd':
    case 'day':
    case 'days':
      return value * 86_400_000;
    case 'w':
    case 'week':
    case 'weeks':
      return value * 604_800_000;
    default:
      throw new Error(`Unknown duration unit: "${unit}"`);
  }
}

// ---------------------------------------------------------------------------
// Vault
// ---------------------------------------------------------------------------

/**
 * High-level credential vault for AI agent payment credentials.
 *
 * Provides a simple API over the underlying {@link VaultStore} for
 * storing, retrieving, revoking, and cleaning up credentials across
 * multiple payment protocols.
 *
 * @example
 * ```typescript
 * import { createVault } from '@openagentpay/vault';
 *
 * // In-memory vault for development
 * const vault = createVault();
 *
 * // Store a credential
 * const id = await vault.storeCredential('agent-1', 'stripe', {
 *   apiKey: 'sk_test_...',
 *   publishableKey: 'pk_test_...',
 * }, { expiresIn: '30d' });
 *
 * // Retrieve it
 * const cred = await vault.getCredential('agent-1', 'stripe');
 * ```
 */
export class Vault {
  private readonly store: VaultStore;

  constructor(config?: VaultConfig) {
    const type = config?.type ?? 'memory';

    if (type === 'encrypted') {
      if (!config?.encryptionKey) {
        throw new Error('VaultConfig.encryptionKey is required when type is "encrypted"');
      }
      this.store = new EncryptedVaultStore(config.encryptionKey);
    } else {
      this.store = new InMemoryVaultStore();
    }
  }

  /**
   * Store a credential for an agent.
   *
   * @param agentId - The agent or entity identifier.
   * @param protocol - The payment protocol (e.g. 'stripe', 'mpp', 'x402').
   * @param credential - Key-value credential data.
   * @param options - Optional expiration and metadata.
   * @returns The unique credential ID.
   */
  async storeCredential(
    agentId: string,
    protocol: string,
    credential: Record<string, string>,
    options?: {
      /** Duration until expiry (e.g. "30d", "24h", "1w"). */
      expiresIn?: string;
      /** Additional metadata to store alongside the credential. */
      metadata?: Record<string, string>;
    },
  ): Promise<string> {
    const id = randomUUID();
    const now = new Date().toISOString();

    let expiresAt: string | null = null;
    if (options?.expiresIn) {
      const ms = parseDuration(options.expiresIn);
      expiresAt = new Date(Date.now() + ms).toISOString();
    }

    const entry: VaultEntry = {
      id,
      agentId,
      protocol: protocol as VaultProtocol,
      credential,
      expiresAt,
      createdAt: now,
      lastUsedAt: null,
      active: true,
      metadata: options?.metadata,
    };

    await this.store.store(entry);
    return id;
  }

  /**
   * Retrieve the active credential for an agent + protocol.
   *
   * Returns `null` if no active credential exists for the combination,
   * or if the credential has expired.
   *
   * @param agentId - The agent or entity identifier.
   * @param protocol - The payment protocol to look up.
   * @returns The credential data, or `null`.
   */
  async getCredential(agentId: string, protocol: string): Promise<Record<string, string> | null> {
    const entry = await this.store.retrieveByProtocol(agentId, protocol);
    if (!entry) return null;

    // Check expiry
    if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= Date.now()) {
      // Credential has expired — deactivate and return null
      await this.store.revoke(entry.id);
      return null;
    }

    return entry.credential;
  }

  /**
   * List all active credentials for an agent.
   *
   * @param agentId - The agent or entity identifier.
   * @returns Array of active vault entries.
   */
  async listCredentials(agentId: string): Promise<VaultEntry[]> {
    return this.store.listActive(agentId);
  }

  /**
   * Revoke a credential, making it inactive.
   *
   * @param id - The unique credential ID.
   */
  async revokeCredential(id: string): Promise<void> {
    await this.store.revoke(id);
  }

  /**
   * Mark a credential as recently used (updates `lastUsedAt` timestamp).
   *
   * @param id - The unique credential ID.
   */
  async markUsed(id: string): Promise<void> {
    await this.store.update(id, { lastUsedAt: new Date().toISOString() });
  }

  /**
   * Clean up expired credentials from the store.
   *
   * @returns The number of expired entries removed.
   */
  async cleanup(): Promise<number> {
    return this.store.cleanup();
  }
}
