/**
 * @module types
 *
 * Internal types for the Solana SPL token adapter package.
 *
 * These types are specific to the Solana payment flow — transaction
 * construction, proof verification, and wallet configuration.
 */

// ---------------------------------------------------------------------------
// Adapter Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the server-side SolanaAdapter.
 */
export interface SolanaAdapterConfig {
  /** Solana JSON-RPC URL for transaction verification. */
  rpcUrl?: string

  /**
   * Set of supported SPL token mint addresses.
   *
   * Only transactions targeting these mints will be accepted.
   * Defaults to USDC on mainnet if not specified.
   */
  supportedTokens?: string[]

  /**
   * Required confirmation level for transaction verification.
   * @default 'confirmed'
   */
  confirmationLevel?: 'confirmed' | 'finalized'
}

// ---------------------------------------------------------------------------
// Wallet Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the client-side SolanaWallet.
 */
export interface SolanaWalletConfig {
  /**
   * Ed25519 private key — either a base58-encoded string or
   * a 64-byte Uint8Array (Solana keypair format: 32-byte secret + 32-byte public).
   */
  privateKey: string | Uint8Array

  /** Solana JSON-RPC URL for transaction submission. */
  rpcUrl?: string

  /**
   * SPL token mint address to use for payments.
   *
   * Defaults to USDC on mainnet-beta if not specified.
   */
  tokenMint?: string
}

// ---------------------------------------------------------------------------
// Payment Proof
// ---------------------------------------------------------------------------

/**
 * Proof of a Solana SPL token payment.
 *
 * This is base64-encoded and sent in the X-SOLANA-PAYMENT header.
 */
export interface SolanaPaymentProof {
  /** Transaction signature (base58-encoded). */
  signature: string

  /** Slot in which the transaction was confirmed. */
  slot: number

  /** SPL token mint address used for the payment. */
  tokenMint: string
}

// ---------------------------------------------------------------------------
// Token Info
// ---------------------------------------------------------------------------

/**
 * Metadata for a supported SPL token.
 */
export interface SolanaTokenInfo {
  /** Token mint address (base58-encoded). */
  mint: string

  /** Number of decimal places for the token. */
  decimals: number

  /** Human-readable token symbol (e.g. "USDC"). */
  symbol: string
}
