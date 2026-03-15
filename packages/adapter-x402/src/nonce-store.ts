/**
 * @module nonce-store
 *
 * Nonce storage for EIP-3009 replay protection.
 *
 * Every transferWithAuthorization includes a unique nonce. Once a
 * payment is verified and settled, the nonce is recorded so the
 * same authorization cannot be submitted again.
 */

import { NONCE_MAX_AGE_MS } from './constants.js'
import type { NonceStore } from './types.js'

/**
 * In-memory nonce store suitable for single-process servers.
 *
 * Stores nonces in a Map with timestamps, and periodically prunes
 * entries older than 24 hours to prevent unbounded memory growth.
 *
 * For multi-process or distributed deployments, implement the
 * {@link NonceStore} interface with a shared store (Redis, PostgreSQL, etc.).
 *
 * @example
 * ```ts
 * const store = new InMemoryNonceStore()
 * await store.hasBeenUsed('0xabc...') // false
 * await store.markAsUsed('0xabc...')
 * await store.hasBeenUsed('0xabc...') // true
 * ```
 */
export class InMemoryNonceStore implements NonceStore {
  /** Map of nonce → timestamp when it was recorded. */
  private readonly nonces = new Map<string, number>()

  /** Interval handle for periodic cleanup. */
  private cleanupInterval: ReturnType<typeof setInterval> | undefined

  /** How often to run cleanup (default: every hour). */
  private readonly cleanupIntervalMs: number

  /** Maximum nonce age before it can be pruned. */
  private readonly maxAgeMs: number

  constructor(options?: { cleanupIntervalMs?: number; maxAgeMs?: number }) {
    this.cleanupIntervalMs = options?.cleanupIntervalMs ?? 60 * 60 * 1000
    this.maxAgeMs = options?.maxAgeMs ?? NONCE_MAX_AGE_MS

    // Start periodic cleanup
    this.cleanupInterval = setInterval(() => this.cleanup(), this.cleanupIntervalMs)

    // Allow the process to exit even if the interval is active
    if (this.cleanupInterval && typeof this.cleanupInterval === 'object' && 'unref' in this.cleanupInterval) {
      this.cleanupInterval.unref()
    }
  }

  /**
   * Check whether a nonce has already been used.
   */
  async hasBeenUsed(nonce: string): Promise<boolean> {
    return this.nonces.has(nonce)
  }

  /**
   * Record a nonce as used with the current timestamp.
   */
  async markAsUsed(nonce: string): Promise<void> {
    this.nonces.set(nonce, Date.now())
  }

  /**
   * Remove nonces older than the configured max age.
   * Called automatically on a periodic interval.
   */
  private cleanup(): void {
    const cutoff = Date.now() - this.maxAgeMs
    for (const [nonce, timestamp] of this.nonces) {
      if (timestamp < cutoff) {
        this.nonces.delete(nonce)
      }
    }
  }

  /**
   * Stop the cleanup interval and clear all stored nonces.
   * Call this during graceful shutdown or in tests.
   */
  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = undefined
    }
    this.nonces.clear()
  }

  /**
   * Returns the number of nonces currently stored.
   * Useful for monitoring and debugging.
   */
  get size(): number {
    return this.nonces.size
  }
}
