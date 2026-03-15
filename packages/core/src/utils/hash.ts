/**
 * @module hash
 *
 * SHA-256 hashing utilities for content verification.
 *
 * Used in receipts to create verifiable hashes of request and
 * response bodies without exposing the actual content.
 */

import { createHash } from "node:crypto";

/**
 * Compute the SHA-256 hash of the given content.
 *
 * @param content - The content to hash. Strings are encoded as UTF-8.
 *                  Buffers and Uint8Arrays are hashed directly.
 * @returns Hex-encoded SHA-256 hash string.
 *
 * @example
 * ```typescript
 * const hash = sha256('hello world');
 * // => "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
 *
 * const bodyHash = sha256(JSON.stringify(requestBody));
 * ```
 */
export function sha256(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Compute a prefixed SHA-256 hash suitable for receipt fields.
 *
 * Returns the hash in the format `"sha256:<hex>"` for unambiguous
 * identification of the hash algorithm used.
 *
 * @param content - The content to hash.
 * @returns Prefixed hash string (e.g. `"sha256:b94d27b9..."`).
 *
 * @example
 * ```typescript
 * const hash = sha256Prefixed(responseBody);
 * // => "sha256:b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
 * ```
 */
export function sha256Prefixed(
  content: string | Uint8Array,
): string {
  return `sha256:${sha256(content)}`;
}
