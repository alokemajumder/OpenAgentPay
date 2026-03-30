/**
 * @module identity
 *
 * Agent identity types for verifiable agent authentication.
 * Supports DID-based identity with Ed25519 attestations.
 */

/** A decentralized identifier for an agent. */
export interface AgentDID {
  /** DID URI (e.g., 'did:key:z6Mk...') */
  id: string;
  /** DID method (e.g., 'key', 'web', 'pkh') */
  method: string;
  /** Public key bytes as hex */
  publicKey: string;
  /** Key type */
  keyType: 'Ed25519' | 'secp256k1';
  /** Human-readable label */
  label?: string;
  /** Creation timestamp */
  created: string;
}

/** An Ed25519 attestation — a signed claim about an agent. */
export interface AgentAttestation {
  /** Unique attestation ID */
  id: string;
  /** The claim type (e.g., 'payment-authorization', 'identity', 'capability') */
  type: string;
  /** The agent DID making the attestation */
  issuer: string;
  /** The subject DID (agent being attested) */
  subject: string;
  /** Claim payload */
  claims: Record<string, unknown>;
  /** Ed25519 signature of the canonical claim JSON */
  signature: string;
  /** When the attestation was issued (ISO 8601) */
  issuedAt: string;
  /** When the attestation expires (ISO 8601) */
  expiresAt?: string;
}

/** Configuration for agent identity management. */
export interface AgentIdentityConfig {
  /** Ed25519 private key (hex or Uint8Array) for signing attestations */
  privateKey: string;
  /** DID method to use. Default: 'key' */
  didMethod?: 'key' | 'web' | 'pkh';
  /** Agent label */
  label?: string;
}

/** KYA (Know Your Agent) compliance profile. */
export interface KYAProfile {
  /** Agent DID */
  did: string;
  /** Agent name or label */
  name?: string;
  /** Agent operator/owner */
  operator?: string;
  /** Compliance level: 'none' | 'basic' | 'verified' */
  level: 'none' | 'basic' | 'verified';
  /** Capabilities declared by the agent */
  capabilities: string[];
  /** Maximum spend authorization */
  maxSpendAuthorization?: string;
  /** Attestations proving identity */
  attestations: AgentAttestation[];
}
