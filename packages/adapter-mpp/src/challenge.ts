/**
 * @module challenge
 *
 * MPP Challenge construction and serialization.
 *
 * A Challenge is issued by the server in a 402 response. It contains
 * payment details and a unique ID that the client must reference in
 * the corresponding Credential.
 */

import type { MPPChallenge } from './types.js'

// ---------------------------------------------------------------------------
// ID Generation
// ---------------------------------------------------------------------------

/**
 * Generates a unique challenge ID with timestamp prefix for sortability.
 *
 * Format: `mpp_ch_{timestamp36}_{random16}`
 *
 * @returns A unique challenge identifier
 */
function generateChallengeId(): string {
  const timestamp = Date.now().toString(36).padStart(10, '0')
  const chars = '0123456789abcdefghjkmnpqrstvwxyz'
  let random = ''
  for (let i = 0; i < 16; i++) {
    random += chars[Math.floor(Math.random() * chars.length)]
  }
  return `mpp_ch_${timestamp}${random}`
}

// ---------------------------------------------------------------------------
// Challenge Construction
// ---------------------------------------------------------------------------

/**
 * Creates a new MPP Challenge.
 *
 * The challenge contains all the information an agent needs to make
 * a payment: amount, currency, recipient, and accepted networks.
 *
 * @param config - Challenge configuration
 * @param config.amount - Payment amount as a decimal string (e.g., '0.01')
 * @param config.currency - Currency code (e.g., 'USD', 'USDC')
 * @param config.recipient - Recipient wallet address or account
 * @param config.networks - Accepted payment networks
 * @param config.ttlSeconds - Time-to-live in seconds (default: 300)
 * @param config.sessionSupported - Whether sessions are supported
 * @param config.metadata - Additional metadata
 * @returns A fully constructed MPPChallenge
 *
 * @example
 * ```typescript
 * const challenge = createChallenge({
 *   amount: '0.01',
 *   currency: 'USD',
 *   recipient: '0xabc123...',
 *   networks: ['tempo', 'stripe'],
 * })
 * ```
 */
export function createChallenge(config: {
  amount: string;
  currency: string;
  recipient: string;
  networks: string[];
  ttlSeconds?: number;
  sessionSupported?: boolean;
  metadata?: Record<string, string>;
}): MPPChallenge {
  const ttl = config.ttlSeconds ?? 300
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString()

  return {
    version: '1.0',
    challengeId: generateChallengeId(),
    amount: config.amount,
    currency: config.currency,
    recipient: config.recipient,
    networks: config.networks,
    expiresAt,
    sessionSupported: config.sessionSupported,
    metadata: config.metadata,
  }
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Serializes an MPP Challenge to a base64-encoded JSON string
 * suitable for inclusion in HTTP headers or response bodies.
 *
 * @param challenge - The challenge to serialize
 * @returns Base64-encoded JSON string
 */
export function serializeChallenge(challenge: MPPChallenge): string {
  const json = JSON.stringify(challenge)
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(json, 'utf-8').toString('base64')
  }
  return btoa(json)
}

/**
 * Deserializes an MPP Challenge from a base64-encoded JSON string.
 *
 * @param encoded - Base64-encoded challenge string
 * @returns The deserialized MPPChallenge
 * @throws {Error} If the string cannot be decoded or parsed
 */
export function deserializeChallenge(encoded: string): MPPChallenge {
  let json: string
  if (typeof Buffer !== 'undefined') {
    json = Buffer.from(encoded, 'base64').toString('utf-8')
  } else {
    json = atob(encoded)
  }

  const parsed = JSON.parse(json) as MPPChallenge

  if (!parsed.version || !parsed.challengeId || !parsed.amount) {
    throw new Error('Invalid MPP Challenge: missing required fields')
  }

  return parsed
}

/**
 * Checks whether an MPP Challenge has expired.
 *
 * @param challenge - The challenge to check
 * @returns `true` if the challenge has expired
 */
export function isChallengeExpired(challenge: MPPChallenge): boolean {
  return new Date(challenge.expiresAt).getTime() < Date.now()
}
