/**
 * @module types
 *
 * Internal types for the Lightning Network BOLT11 adapter package.
 *
 * These types are specific to the Lightning payment flow — LND REST
 * communication, invoice management, and proof verification.
 */

// ---------------------------------------------------------------------------
// Adapter Configuration (server-side)
// ---------------------------------------------------------------------------

/**
 * Configuration for the server-side LightningAdapter.
 *
 * Connects to an LND node via its REST API for invoice creation
 * and payment verification.
 */
export interface LightningAdapterConfig {
  /** LND REST API URL (e.g. `"https://localhost:8080"`). */
  nodeUrl: string

  /** Admin or invoice macaroon as a hex-encoded string. */
  macaroon: string

  /**
   * TLS certificate for self-signed LND nodes (PEM-encoded).
   *
   * Required when connecting to LND nodes with self-signed certs
   * (the default LND configuration). Not needed for publicly
   * signed certificates.
   */
  tlsCert?: string

  /**
   * Invoice expiry in seconds.
   * @default 600
   */
  invoiceExpirySeconds?: number

  /** Minimum payment amount in satoshis. Rejects invoices below this. */
  minAmountSats?: number

  /** Maximum payment amount in satoshis. Rejects invoices above this. */
  maxAmountSats?: number
}

// ---------------------------------------------------------------------------
// Wallet Configuration (client-side)
// ---------------------------------------------------------------------------

/**
 * Configuration for the client-side LightningWallet.
 *
 * Connects to an LND node to pay BOLT11 invoices on behalf of
 * an AI agent.
 */
export interface LightningWalletConfig {
  /** LND REST API URL (e.g. `"https://localhost:8080"`). */
  nodeUrl: string

  /** Admin macaroon as a hex-encoded string (needs sendpayment permission). */
  macaroon: string

  /**
   * TLS certificate for self-signed LND nodes (PEM-encoded).
   */
  tlsCert?: string

  /** Maximum routing fee in satoshis allowed per payment. */
  maxFeeSats?: number

  /** Optional payer identifier included in proofs for attribution. */
  payerIdentifier?: string
}

// ---------------------------------------------------------------------------
// Lightning Invoice
// ---------------------------------------------------------------------------

/**
 * A BOLT11 Lightning invoice issued by the server adapter.
 */
export interface LightningInvoice {
  /** The BOLT11-encoded payment request string. */
  paymentRequest: string

  /** The payment hash (hex-encoded, 32 bytes). */
  rHash: string

  /** Invoice amount in satoshis. */
  amountSats: number

  /** ISO 8601 expiration timestamp. */
  expiresAt: string

  /** Optional memo/description attached to the invoice. */
  memo?: string
}

// ---------------------------------------------------------------------------
// Payment Proof
// ---------------------------------------------------------------------------

/**
 * Proof of a Lightning payment — the preimage that satisfies the
 * payment hash.
 *
 * In Lightning, knowledge of the preimage proves that the payment
 * was completed, because only the recipient can reveal it.
 */
export interface LightningPaymentProof {
  /** Payment preimage (hex-encoded, 32 bytes). */
  preimage: string

  /** Payment hash (hex-encoded, 32 bytes). */
  rHash: string

  /** Amount paid in satoshis. */
  amountSats: number
}
