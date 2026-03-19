/**
 * @module types
 *
 * Type definitions for the OpenAgentPay credential vault.
 */

// ---------------------------------------------------------------------------
// Supported Protocols
// ---------------------------------------------------------------------------

/**
 * Payment protocols that the vault can store credentials for.
 */
export type VaultProtocol =
  | 'mpp'
  | 'x402'
  | 'visa'
  | 'stripe'
  | 'paypal'
  | 'upi'
  | 'credits';

// ---------------------------------------------------------------------------
// Vault Entry
// ---------------------------------------------------------------------------

/**
 * A single credential stored in the vault.
 *
 * The `credential` field contains the sensitive data (wallet keys, session
 * tokens, API keys, etc.) and is encrypted at rest when using the
 * {@link EncryptedVaultStore}.
 */
export interface VaultEntry {
  /** Unique credential ID. */
  id: string;

  /** Agent or entity this credential belongs to. */
  agentId: string;

  /** Payment protocol this credential is for. */
  protocol: VaultProtocol;

  /** The credential data (encrypted at rest in EncryptedVaultStore). */
  credential: Record<string, string>;

  /** When this credential expires (ISO 8601), null if no expiry. */
  expiresAt: string | null;

  /** When this credential was stored (ISO 8601). */
  createdAt: string;

  /** When this credential was last used (ISO 8601), null if never used. */
  lastUsedAt: string | null;

  /** Whether this credential is active. */
  active: boolean;

  /** Additional metadata. */
  metadata?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Vault Store Interface
// ---------------------------------------------------------------------------

/**
 * Storage backend interface for the credential vault.
 *
 * Implementations must handle persistence and may optionally handle
 * encryption (see {@link EncryptedVaultStore}).
 */
export interface VaultStore {
  /** Persist a credential entry. Must be idempotent on `entry.id`. */
  store(entry: VaultEntry): Promise<void>;

  /** Retrieve a credential by its unique ID, or `null` if not found. */
  retrieve(id: string): Promise<VaultEntry | null>;

  /** Retrieve all credentials belonging to an agent. */
  retrieveByAgent(agentId: string): Promise<VaultEntry[]>;

  /** Retrieve the active credential for an agent + protocol combination, or `null`. */
  retrieveByProtocol(agentId: string, protocol: string): Promise<VaultEntry | null>;

  /** Apply partial updates to a credential entry. */
  update(id: string, updates: Partial<VaultEntry>): Promise<void>;

  /** Revoke (deactivate) a credential by ID. */
  revoke(id: string): Promise<void>;

  /** List all active credentials for an agent. */
  listActive(agentId: string): Promise<VaultEntry[]>;

  /** Remove expired entries from the store. Returns the number of entries removed. */
  cleanup(): Promise<number>;
}

// ---------------------------------------------------------------------------
// Vault Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for creating a {@link Vault} instance.
 */
export interface VaultConfig {
  /** Storage backend type. @default 'memory' */
  type?: 'memory' | 'encrypted';

  /**
   * Encryption key for the encrypted store.
   * Must be a 64-character hex string (32 bytes) when `type` is `'encrypted'`.
   */
  encryptionKey?: string;
}
