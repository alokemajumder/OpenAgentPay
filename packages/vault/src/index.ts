/**
 * @openagentpay/vault
 *
 * Credential vault for OpenAgentPay — securely store, retrieve, and
 * rotate agent payment credentials (wallet keys, session tokens,
 * mandate IDs, API keys) across protocols in one secure location.
 *
 * @example
 * ```typescript
 * import { createVault } from '@openagentpay/vault';
 *
 * // In-memory vault (development / testing)
 * const vault = createVault();
 *
 * // Encrypted vault (production)
 * const secureVault = createVault({
 *   type: 'encrypted',
 *   encryptionKey: process.env.VAULT_KEY!, // 64-char hex string
 * });
 *
 * // Store a credential
 * const id = await secureVault.storeCredential('agent-1', 'stripe', {
 *   apiKey: 'sk_live_...',
 * }, { expiresIn: '30d' });
 *
 * // Retrieve it
 * const cred = await secureVault.getCredential('agent-1', 'stripe');
 * ```
 *
 * @packageDocumentation
 */

export { Vault } from './vault.js';
export { InMemoryVaultStore } from './memory-store.js';
export { EncryptedVaultStore } from './encrypted-store.js';

export type {
  VaultConfig,
  VaultEntry,
  VaultProtocol,
  VaultStore,
} from './types.js';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

import type { VaultConfig } from './types.js';
import { Vault } from './vault.js';

/**
 * Create a new credential vault.
 *
 * @param config - Optional configuration. Defaults to an in-memory store.
 * @returns A configured {@link Vault} instance.
 *
 * @example
 * ```typescript
 * // In-memory (default)
 * const vault = createVault();
 *
 * // Encrypted with a 32-byte hex key
 * const vault = createVault({
 *   type: 'encrypted',
 *   encryptionKey: 'a1b2c3...', // 64 hex chars
 * });
 * ```
 */
export function createVault(config?: VaultConfig): Vault {
  return new Vault(config);
}
