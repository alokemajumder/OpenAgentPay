/**
 * @module ulid
 *
 * Minimal, dependency-free ULID (Universally Unique Lexicographically
 * Sortable Identifier) generator.
 *
 * ULIDs are 26-character, base32-encoded identifiers consisting of:
 * - 10 characters of millisecond timestamp (48 bits)
 * - 16 characters of cryptographic randomness (80 bits)
 *
 * Properties:
 * - Lexicographically sortable (timestamp prefix)
 * - Case-insensitive
 * - No special characters (URL-safe)
 * - 1.21e+24 unique IDs per millisecond
 *
 * @see https://github.com/ulid/spec
 */

import { randomBytes } from "node:crypto";

/**
 * Crockford's Base32 encoding alphabet.
 * Excludes I, L, O, U to avoid ambiguity and profanity.
 */
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Length of the timestamp component (10 characters = 48 bits). */
const TIMESTAMP_LEN = 10;

/** Length of the random component (16 characters = 80 bits). */
const RANDOM_LEN = 16;

/**
 * Encode a 48-bit timestamp into 10 Crockford Base32 characters.
 *
 * @param timestamp - Unix epoch milliseconds.
 * @returns 10-character base32 string.
 */
function encodeTimestamp(timestamp: number): string {
  let ts = timestamp;
  const chars: string[] = new Array(TIMESTAMP_LEN);

  for (let i = TIMESTAMP_LEN - 1; i >= 0; i--) {
    chars[i] = ENCODING[ts & 0x1f]!;
    ts = Math.floor(ts / 32);
  }

  return chars.join("");
}

/**
 * Generate 16 Crockford Base32 characters of cryptographic randomness.
 *
 * Uses `crypto.getRandomValues` (available in Node 19+ and all modern
 * browsers) for cryptographic-quality randomness.
 *
 * @returns 16-character base32 string.
 */
function encodeRandom(): string {
  const chars: string[] = new Array(RANDOM_LEN);

  // Generate 10 random bytes (80 bits) — we need 16 base32 chars (5 bits each)
  const bytes = randomBytes(RANDOM_LEN);

  for (let i = 0; i < RANDOM_LEN; i++) {
    // Each byte provides 8 bits; we only need 5 bits per character
    chars[i] = ENCODING[bytes[i]! & 0x1f]!;
  }

  return chars.join("");
}

/**
 * Generate a new ULID.
 *
 * Returns a 26-character string: 10 chars timestamp + 16 chars random.
 *
 * @param timestamp - Optional Unix epoch milliseconds. Defaults to `Date.now()`.
 * @returns A new ULID string.
 *
 * @example
 * ```typescript
 * const id = ulid();
 * // => "01HX3KQVR8ABCDEFGHJKMNPQRS"
 *
 * // With explicit timestamp
 * const id2 = ulid(1700000000000);
 * ```
 */
export function ulid(timestamp?: number): string {
  const ts = timestamp ?? Date.now();
  return encodeTimestamp(ts) + encodeRandom();
}

/**
 * Extract the millisecond timestamp from a ULID.
 *
 * @param id - A 26-character ULID string.
 * @returns Unix epoch milliseconds encoded in the ULID.
 *
 * @example
 * ```typescript
 * const id = ulid();
 * const ts = extractTimestamp(id);
 * // ts ≈ Date.now()
 * ```
 */
export function extractTimestamp(id: string): number {
  const timestampChars = id.slice(0, TIMESTAMP_LEN).toUpperCase();
  let timestamp = 0;

  for (let i = 0; i < TIMESTAMP_LEN; i++) {
    const charIndex = ENCODING.indexOf(timestampChars[i]!);
    if (charIndex === -1) {
      throw new Error(
        `Invalid ULID character: "${timestampChars[i]}" at position ${i}`,
      );
    }
    timestamp = timestamp * 32 + charIndex;
  }

  return timestamp;
}
