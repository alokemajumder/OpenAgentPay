/**
 * @module encrypted-store
 *
 * AES-256-GCM encrypted implementation of the {@link VaultStore} interface.
 * Encrypts the `credential` field at rest while keeping all other fields
 * (id, agentId, protocol, timestamps, etc.) in plaintext for querying.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
// Buffer/Uint8Array incompatibility in TS 5.9 — runtime behavior is correct.

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  pbkdf2Sync,
} from 'node:crypto';

import type { VaultEntry, VaultStore } from './types.js';

/** Internal representation with encrypted credential data. */
interface EncryptedEntry {
  /** The vault entry with `credential` replaced by encrypted blob. */
  entry: Omit<VaultEntry, 'credential'>;
  /** AES-256-GCM encrypted credential JSON. Base64-encoded. */
  ciphertext: string;
  /** Initialization vector used for encryption. Base64-encoded. */
  iv: string;
  /** GCM authentication tag. Base64-encoded. */
  authTag: string;
}

/**
 * Derive a 32-byte key from a passphrase using PBKDF2.
 * Used when the provided key is not exactly 32 bytes (64 hex chars).
 */
function deriveKey(passphrase: string): Buffer {
  // Static salt — acceptable because each entry uses a unique IV.
  // In production, consider a per-vault salt stored alongside config.
  const salt = Buffer.from('openagentpay-vault-v1', 'utf8');
  return pbkdf2Sync(passphrase, salt as any, 100_000, 32, 'sha256');
}

/**
 * Parse the encryption key: if it's a 64-character hex string, decode
 * it directly; otherwise derive a key via PBKDF2.
 */
function resolveKey(keyInput: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(keyInput)) {
    return Buffer.from(keyInput, 'hex');
  }
  return deriveKey(keyInput);
}

/**
 * Encrypted credential store using AES-256-GCM.
 *
 * - Each entry is encrypted with a unique random IV (12 bytes).
 * - Only the `credential` field is encrypted; all other fields remain
 *   in plaintext so they can be queried and filtered.
 * - The GCM authentication tag ensures tamper detection.
 *
 * @example
 * ```typescript
 * const store = new EncryptedVaultStore('a'.repeat(64)); // 32-byte hex key
 * await store.store(entry);
 * const retrieved = await store.retrieve(entry.id);
 * // retrieved.credential is decrypted transparently
 * ```
 */
export class EncryptedVaultStore implements VaultStore {
  private readonly key: Buffer;
  private readonly entries = new Map<string, EncryptedEntry>();

  /**
   * Create an encrypted vault store.
   * @param encryptionKey - A 64-character hex string (32 bytes) or a passphrase
   *   that will be derived into a key via PBKDF2.
   */
  constructor(encryptionKey: string) {
    if (!encryptionKey) {
      throw new Error('EncryptedVaultStore requires an encryption key');
    }
    this.key = resolveKey(encryptionKey);
  }

  /** Encrypt the credential field and persist the entry. */
  async store(entry: VaultEntry): Promise<void> {
    const encrypted = this.encrypt(entry);
    this.entries.set(entry.id, encrypted);
  }

  /** Retrieve and decrypt a credential by its unique ID, or `null` if not found. */
  async retrieve(id: string): Promise<VaultEntry | null> {
    const encrypted = this.entries.get(id);
    if (!encrypted) return null;
    return this.decrypt(encrypted);
  }

  /** Retrieve all credentials belonging to an agent (decrypted). */
  async retrieveByAgent(agentId: string): Promise<VaultEntry[]> {
    const results: VaultEntry[] = [];
    for (const encrypted of this.entries.values()) {
      if (encrypted.entry.agentId === agentId) {
        results.push(this.decrypt(encrypted));
      }
    }
    return results;
  }

  /** Retrieve the active credential for an agent + protocol combination (decrypted), or `null`. */
  async retrieveByProtocol(agentId: string, protocol: string): Promise<VaultEntry | null> {
    for (const encrypted of this.entries.values()) {
      if (
        encrypted.entry.agentId === agentId &&
        encrypted.entry.protocol === protocol &&
        encrypted.entry.active
      ) {
        return this.decrypt(encrypted);
      }
    }
    return null;
  }

  /** Apply partial updates to a credential entry. Re-encrypts if `credential` is updated. */
  async update(id: string, updates: Partial<VaultEntry>): Promise<void> {
    const encrypted = this.entries.get(id);
    if (!encrypted) {
      throw new Error(`VaultEntry not found: ${id}`);
    }

    // If credential is being updated, we need to decrypt, merge, and re-encrypt
    if (updates.credential) {
      const decrypted = this.decrypt(encrypted);
      Object.assign(decrypted, updates);
      const reEncrypted = this.encrypt(decrypted);
      this.entries.set(id, reEncrypted);
    } else {
      // Only metadata fields changed — update plaintext portion
      Object.assign(encrypted.entry, updates);
    }
  }

  /** Revoke (deactivate) a credential by ID. No-op if the entry does not exist. */
  async revoke(id: string): Promise<void> {
    const encrypted = this.entries.get(id);
    if (encrypted) {
      encrypted.entry.active = false;
    }
  }

  /** List all active credentials for an agent (decrypted). */
  async listActive(agentId: string): Promise<VaultEntry[]> {
    const results: VaultEntry[] = [];
    for (const encrypted of this.entries.values()) {
      if (encrypted.entry.agentId === agentId && encrypted.entry.active) {
        results.push(this.decrypt(encrypted));
      }
    }
    return results;
  }

  /** Remove expired entries from the store. Returns the number of entries removed. */
  async cleanup(): Promise<number> {
    const now = Date.now();
    let removed = 0;
    for (const [id, encrypted] of this.entries) {
      if (
        encrypted.entry.expiresAt &&
        new Date(encrypted.entry.expiresAt).getTime() <= now
      ) {
        this.entries.delete(id);
        removed++;
      }
    }
    return removed;
  }

  // -----------------------------------------------------------------------
  // Private encryption helpers
  // -----------------------------------------------------------------------

  /** Encrypt a VaultEntry's credential field using AES-256-GCM. */
  private encrypt(entry: VaultEntry): EncryptedEntry {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key as any, iv as any);

    const plaintext = JSON.stringify(entry.credential);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8') as any,
      cipher.final() as any,
    ] as any);
    const authTag = cipher.getAuthTag();

    // Separate credential from the rest of the entry
    const { credential: _, ...rest } = entry;

    return {
      entry: JSON.parse(JSON.stringify(rest)),
      ciphertext: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
    };
  }

  /** Decrypt an EncryptedEntry back into a full VaultEntry. */
  private decrypt(encrypted: EncryptedEntry): VaultEntry {
    const iv = Buffer.from(encrypted.iv, 'base64');
    const authTag = Buffer.from(encrypted.authTag, 'base64');
    const ciphertext = Buffer.from(encrypted.ciphertext, 'base64');

    const decipher = createDecipheriv('aes-256-gcm', this.key as any, iv as any);
    decipher.setAuthTag(authTag as any);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext as any) as any,
      decipher.final() as any,
    ] as any);

    const credential = JSON.parse(decrypted.toString('utf8')) as Record<string, string>;

    return {
      ...JSON.parse(JSON.stringify(encrypted.entry)),
      credential,
    };
  }
}
