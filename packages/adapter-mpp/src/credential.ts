/**
 * @module credential
 *
 * MPP Credential construction and validation.
 *
 * A Credential is created by the client after making a payment. It
 * references the Challenge by ID and includes proof of payment on
 * the selected network.
 */

import type { MPPCredential } from './types.js'

// ---------------------------------------------------------------------------
// Credential Construction
// ---------------------------------------------------------------------------

/**
 * Creates a new MPP Credential.
 *
 * The credential proves that the client made a payment in response
 * to a specific challenge. It includes network-specific proof such
 * as a transaction hash, PaymentIntent ID, or Lightning preimage.
 *
 * @param config - Credential configuration
 * @param config.challengeId - The challenge ID being responded to
 * @param config.network - The payment network used
 * @param config.proof - Network-specific proof of payment
 * @param config.payer - Payer identity (wallet address or account)
 * @returns A fully constructed MPPCredential
 *
 * @example
 * ```typescript
 * const credential = createCredential({
 *   challengeId: 'mpp_ch_abc123...',
 *   network: 'tempo',
 *   proof: { transactionHash: '0xdef456...' },
 *   payer: '0xabc789...',
 * })
 * ```
 */
export function createCredential(config: {
  challengeId: string;
  network: string;
  proof: Record<string, string>;
  payer: string;
}): MPPCredential {
  return {
    version: '1.0',
    challengeId: config.challengeId,
    network: config.network,
    proof: {
      transactionHash: config.proof['transactionHash'],
      paymentIntentId: config.proof['paymentIntentId'],
      preimage: config.proof['preimage'],
    },
    payer: config.payer,
    timestamp: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Serializes an MPP Credential to a base64-encoded JSON string
 * suitable for use in the `Authorization` header.
 *
 * The resulting string is prefixed with `MPP ` to identify the scheme.
 *
 * @param credential - The credential to serialize
 * @returns Authorization header value (e.g., `"MPP eyJ..."`)
 */
export function serializeCredential(credential: MPPCredential): string {
  const json = JSON.stringify(credential)
  let encoded: string
  if (typeof Buffer !== 'undefined') {
    encoded = Buffer.from(json, 'utf-8').toString('base64')
  } else {
    encoded = btoa(json)
  }
  return `MPP ${encoded}`
}

/**
 * Deserializes an MPP Credential from an Authorization header value.
 *
 * Expects the format `"MPP {base64-json}"`.
 *
 * @param headerValue - The Authorization header value
 * @returns The deserialized MPPCredential
 * @throws {Error} If the header value is not valid MPP credential format
 */
export function deserializeCredential(headerValue: string): MPPCredential {
  const trimmed = headerValue.trim()
  if (!trimmed.startsWith('MPP ')) {
    throw new Error('Invalid MPP credential: must start with "MPP " prefix')
  }

  const encoded = trimmed.slice(4)
  let json: string
  if (typeof Buffer !== 'undefined') {
    json = Buffer.from(encoded, 'base64').toString('utf-8')
  } else {
    json = atob(encoded)
  }

  const parsed = JSON.parse(json) as MPPCredential

  if (!parsed.version || !parsed.challengeId || !parsed.network || !parsed.payer) {
    throw new Error('Invalid MPP Credential: missing required fields')
  }

  return parsed
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates that a credential has the required proof for its network.
 *
 * @param credential - The credential to validate
 * @returns `true` if the credential has appropriate proof for its network
 */
export function validateCredentialProof(credential: MPPCredential): boolean {
  switch (credential.network) {
    case 'tempo':
      return typeof credential.proof.transactionHash === 'string' &&
        credential.proof.transactionHash.length > 0
    case 'stripe':
      return typeof credential.proof.paymentIntentId === 'string' &&
        credential.proof.paymentIntentId.length > 0
    case 'lightning':
      return typeof credential.proof.preimage === 'string' &&
        credential.proof.preimage.length > 0
    default:
      // For unknown networks, require at least one proof field
      return Object.values(credential.proof).some(
        (v) => typeof v === 'string' && v.length > 0
      )
  }
}
