/**
 * @module identity
 *
 * Agent identity management using DIDs and Ed25519 attestations.
 *
 * Provides the {@link AgentIdentityManager} class for creating and
 * verifying decentralized agent identities, signing attestations,
 * and building KYA (Know Your Agent) compliance profiles.
 *
 * Uses only Node.js built-in `crypto` module — no external dependencies.
 */

import {
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
  randomUUID,
  type KeyObject,
} from 'node:crypto';

import type {
  AgentDID,
  AgentAttestation,
  AgentIdentityConfig,
  KYAProfile,
} from '@openagentpay/core';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * PKCS#8 DER prefix for Ed25519 private key (seed-only, 32-byte form).
 * Bytes: 30 2e 02 01 00 30 05 06 03 2b 65 70 04 22 04 20
 */
const PKCS8_ED25519_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05,
  0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

/**
 * SubjectPublicKeyInfo DER header for Ed25519 public keys.
 * Bytes: 30 2a 30 05 06 03 2b 65 70 03 21 00
 */
const SPKI_ED25519_HEADER = new Uint8Array([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70,
  0x03, 0x21, 0x00,
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Concatenate two Uint8Arrays. */
function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length);
  result.set(a, 0);
  result.set(b, a.length);
  return result;
}

/** Convert a hex string to Uint8Array. */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/** Convert Uint8Array to hex string. */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Encode bytes as base58btc.
 * Minimal implementation for Ed25519 multicodec encoding.
 */
function base58btcEncode(bytes: Uint8Array): string {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let num = BigInt('0x' + bytesToHex(bytes));
  const chars: string[] = [];
  while (num > 0n) {
    const remainder = num % 58n;
    chars.unshift(ALPHABET[Number(remainder)]!);
    num = num / 58n;
  }
  // Preserve leading zeros
  for (const b of bytes) {
    if (b === 0) chars.unshift('1');
    else break;
  }
  return chars.join('');
}

/**
 * Decode a base58btc string to bytes.
 */
function base58btcDecode(encoded: string): Uint8Array {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const BASE_MAP = new Map<string, number>();
  for (let i = 0; i < ALPHABET.length; i++) {
    BASE_MAP.set(ALPHABET[i]!, i);
  }

  let num = 0n;
  for (const char of encoded) {
    const val = BASE_MAP.get(char);
    if (val === undefined) {
      throw new Error(`Invalid base58 character: ${char}`);
    }
    num = num * 58n + BigInt(val);
  }

  // Convert bigint to bytes
  const hex = num.toString(16);
  const paddedHex = hex.length % 2 === 0 ? hex : '0' + hex;
  const decoded = hexToBytes(paddedHex);

  // Count leading zeros (encoded as '1' in base58)
  let leadingZeros = 0;
  for (const char of encoded) {
    if (char === '1') leadingZeros++;
    else break;
  }

  if (leadingZeros > 0) {
    const result = new Uint8Array(leadingZeros + decoded.length);
    // leading zeros are already 0 by default
    result.set(decoded, leadingZeros);
    return result;
  }

  return decoded;
}

/**
 * Build a did:key URI from an Ed25519 public key.
 *
 * The multicodec prefix for Ed25519 public keys is 0xed01.
 * Result: `did:key:z<base58btc(0xed01 + publicKeyBytes)>`.
 */
function buildDidKey(publicKeyHex: string): string {
  const pubBytes = hexToBytes(publicKeyHex);
  const multicodec = new Uint8Array([0xed, 0x01, ...pubBytes]);
  return `did:key:z${base58btcEncode(multicodec)}`;
}

/**
 * Extract the raw Ed25519 public key hex from a did:key URI.
 */
function extractPublicKeyFromDidKey(didKey: string): string | null {
  try {
    const encoded = didKey.replace('did:key:z', '');
    const bytes = base58btcDecode(encoded);

    // Check multicodec prefix for Ed25519 (0xed 0x01)
    if (bytes.length < 34 || bytes[0] !== 0xed || bytes[1] !== 0x01) {
      return null;
    }

    return bytesToHex(bytes.subarray(2));
  } catch {
    return null;
  }
}

/**
 * Canonicalize a JSON-serializable object for signing.
 * Uses sorted keys to ensure deterministic output.
 */
function canonicalize(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

/** Build a Node.js crypto KeyObject from a 32-byte Ed25519 seed (hex). */
function buildPrivateKey(seedHex: string): KeyObject {
  const seedBytes = hexToBytes(seedHex);
  const pkcs8Der = concatBytes(PKCS8_ED25519_PREFIX, seedBytes);
  return createPrivateKey({
    key: Buffer.from(pkcs8Der),
    format: 'der',
    type: 'pkcs8',
  });
}

/** Build a Node.js crypto KeyObject from a 32-byte Ed25519 public key (hex). */
function buildPublicKey(publicKeyHex: string): KeyObject {
  const pubBytes = hexToBytes(publicKeyHex);
  const spkiDer = concatBytes(SPKI_ED25519_HEADER, pubBytes);
  return createPublicKey({
    key: Buffer.from(spkiDer),
    format: 'der',
    type: 'spki',
  });
}

// ---------------------------------------------------------------------------
// AgentIdentityManager
// ---------------------------------------------------------------------------

/**
 * Manages agent identity using Ed25519 DIDs.
 *
 * Provides methods for:
 * - Deriving a DID from an Ed25519 private key
 * - Signing arbitrary data
 * - Creating and verifying attestations
 * - Building KYA compliance profiles
 *
 * @example
 * ```typescript
 * import { AgentIdentityManager } from '@openagentpay/vault';
 *
 * const manager = new AgentIdentityManager({
 *   privateKey: '0a1b2c...', // 64-char hex (32-byte Ed25519 seed)
 *   label: 'payment-agent-1',
 * });
 *
 * const did = manager.getDID();
 * console.log(did.id); // 'did:key:z6Mk...'
 *
 * const attestation = manager.createAttestation(
 *   did.id,
 *   'payment-authorization',
 *   { maxAmount: '100.00', currency: 'USDC' },
 * );
 * ```
 */
export class AgentIdentityManager {
  private readonly privateKeyObj: KeyObject;
  private readonly publicKeyHex: string;
  private readonly did: AgentDID;

  /**
   * Create a new AgentIdentityManager.
   *
   * @param config - Identity configuration containing the Ed25519 private key seed
   * @throws {Error} If the private key is not a valid 64-character hex string
   */
  constructor(config: AgentIdentityConfig) {
    const seed = config.privateKey;

    // Validate hex seed (32 bytes = 64 hex chars)
    if (!/^[0-9a-fA-F]{64}$/.test(seed)) {
      throw new Error(
        'AgentIdentityConfig.privateKey must be a 64-character hex string (32-byte Ed25519 seed)',
      );
    }

    this.privateKeyObj = buildPrivateKey(seed);

    // Derive the public key
    const publicKeyObj = createPublicKey(this.privateKeyObj);
    const spkiDer = publicKeyObj.export({ type: 'spki', format: 'der' });
    // The raw 32-byte public key is the last 32 bytes of the SPKI DER
    const spkiBytes = new Uint8Array(spkiDer);
    this.publicKeyHex = bytesToHex(spkiBytes.subarray(spkiBytes.length - 32));

    // Build the DID
    const method = config.didMethod ?? 'key';
    const didId = method === 'key'
      ? buildDidKey(this.publicKeyHex)
      : `did:${method}:${this.publicKeyHex}`;

    this.did = {
      id: didId,
      method,
      publicKey: this.publicKeyHex,
      keyType: 'Ed25519',
      label: config.label,
      created: new Date().toISOString(),
    };
  }

  /**
   * Get the agent's DID.
   *
   * @returns The agent's decentralized identifier
   */
  getDID(): AgentDID {
    return { ...this.did };
  }

  /**
   * Sign arbitrary data with the agent's Ed25519 private key.
   *
   * @param data - The data string to sign
   * @returns Hex-encoded Ed25519 signature
   */
  sign(data: string): string {
    const dataBytes = new Uint8Array(Buffer.from(data, 'utf8'));
    const signature = cryptoSign(null, dataBytes, this.privateKeyObj);
    return bytesToHex(new Uint8Array(signature));
  }

  /**
   * Verify an Ed25519 signature.
   *
   * @param data - The original data that was signed
   * @param signature - The hex-encoded signature to verify
   * @param publicKey - The hex-encoded Ed25519 public key of the signer
   * @returns `true` if the signature is valid
   */
  verify(data: string, signature: string, publicKey: string): boolean {
    try {
      const publicKeyObj = buildPublicKey(publicKey);
      const dataBytes = new Uint8Array(Buffer.from(data, 'utf8'));
      const sigBytes = new Uint8Array(hexToBytes(signature));

      return cryptoVerify(null, dataBytes, publicKeyObj, sigBytes);
    } catch {
      return false;
    }
  }

  /**
   * Create a signed attestation about a subject agent.
   *
   * @param subject - The DID of the agent being attested
   * @param type - The attestation type (e.g., 'payment-authorization', 'identity')
   * @param claims - The claims payload
   * @param expiresIn - Optional expiration in milliseconds from now
   * @returns A signed {@link AgentAttestation}
   */
  createAttestation(
    subject: string,
    type: string,
    claims: Record<string, unknown>,
    expiresIn?: number,
  ): AgentAttestation {
    const now = new Date();
    const id = randomUUID();

    const attestation: Omit<AgentAttestation, 'signature'> = {
      id,
      type,
      issuer: this.did.id,
      subject,
      claims,
      issuedAt: now.toISOString(),
    };

    if (expiresIn !== undefined) {
      attestation.expiresAt = new Date(now.getTime() + expiresIn).toISOString();
    }

    // Build the canonical payload to sign
    const payload = canonicalize({
      id: attestation.id,
      type: attestation.type,
      issuer: attestation.issuer,
      subject: attestation.subject,
      claims: attestation.claims,
      issuedAt: attestation.issuedAt,
      ...(attestation.expiresAt ? { expiresAt: attestation.expiresAt } : {}),
    });

    const signature = this.sign(payload);

    return {
      ...attestation,
      signature,
    };
  }

  /**
   * Verify an attestation's signature and expiry.
   *
   * Checks:
   * 1. The attestation has not expired
   * 2. The signature is valid against the canonical payload
   *
   * For did:key issuers, the public key is extracted from the DID.
   * For the manager's own DID, the local public key is used.
   *
   * @param attestation - The attestation to verify
   * @returns `true` if the attestation is valid and not expired
   */
  verifyAttestation(attestation: AgentAttestation): boolean {
    // Check expiry
    if (attestation.expiresAt) {
      const expiresAt = new Date(attestation.expiresAt).getTime();
      if (expiresAt <= Date.now()) {
        return false;
      }
    }

    // Reconstruct the canonical payload
    const payload = canonicalize({
      id: attestation.id,
      type: attestation.type,
      issuer: attestation.issuer,
      subject: attestation.subject,
      claims: attestation.claims,
      issuedAt: attestation.issuedAt,
      ...(attestation.expiresAt ? { expiresAt: attestation.expiresAt } : {}),
    });

    // Resolve the issuer's public key
    let issuerPublicKey: string | null = null;

    if (attestation.issuer === this.did.id) {
      issuerPublicKey = this.publicKeyHex;
    } else if (attestation.issuer.startsWith('did:key:z')) {
      issuerPublicKey = extractPublicKeyFromDidKey(attestation.issuer);
    }

    if (!issuerPublicKey) {
      return false;
    }

    return this.verify(payload, attestation.signature, issuerPublicKey);
  }

  /**
   * Build a KYA (Know Your Agent) compliance profile.
   *
   * @param name - Human-readable agent name
   * @param operator - Agent operator/owner
   * @param capabilities - Capabilities declared by the agent
   * @param maxSpend - Maximum spend authorization
   * @returns A {@link KYAProfile}
   */
  buildKYAProfile(
    name?: string,
    operator?: string,
    capabilities?: string[],
    maxSpend?: string,
  ): KYAProfile {
    // Self-attest identity
    const identityAttestation = this.createAttestation(
      this.did.id,
      'identity',
      {
        name: name ?? this.did.label ?? 'unknown',
        operator: operator ?? 'unknown',
        keyType: this.did.keyType,
        publicKey: this.did.publicKey,
      },
    );

    const effectiveCapabilities = capabilities ?? [];

    // Determine compliance level based on available information
    let level: KYAProfile['level'] = 'none';
    if (name && operator) {
      level = 'basic';
    }

    return {
      did: this.did.id,
      name,
      operator,
      level,
      capabilities: effectiveCapabilities,
      maxSpendAuthorization: maxSpend,
      attestations: [identityAttestation],
    };
  }
}
