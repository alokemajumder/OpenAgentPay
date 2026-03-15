/**
 * @module types
 *
 * Internal types for the x402 adapter package.
 *
 * These types are NOT re-exported from @openagentpay/core — they are
 * specific to the x402 payment flow (EIP-3009, facilitator interaction,
 * nonce management).
 */

// ---------------------------------------------------------------------------
// Adapter Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the server-side X402Adapter.
 */
export interface X402AdapterConfig {
  /** Blockchain network. @default 'base-sepolia' */
  network?: string

  /** Facilitator URL for verification and settlement. */
  facilitatorUrl?: string

  /** Nonce store for replay protection. Defaults to InMemoryNonceStore. */
  nonceStore?: NonceStore

  /** Payment authorization timeout in seconds. @default 300 */
  timeoutSeconds?: number
}

/**
 * Configuration for the client-side X402Wallet.
 */
export interface X402WalletConfig {
  /** Private key as a hex string (0x-prefixed). */
  privateKey: string

  /** Blockchain network. @default 'base-sepolia' */
  network?: string

  /** Optional JSON-RPC URL (reserved for future on-chain interactions). */
  rpcUrl?: string
}

// ---------------------------------------------------------------------------
// x402 Payment Payload
// ---------------------------------------------------------------------------

/**
 * The x402 payment payload that is base64-encoded and sent in the
 * X-PAYMENT header. This contains the EIP-3009 authorization and
 * the EIP-712 signature.
 */
export interface X402Payment {
  /** Payment scheme identifier. Always "exact" for x402. */
  scheme: 'exact'

  /** Blockchain network (e.g. "base", "base-sepolia"). */
  network: string

  /** EIP-3009 authorization parameters. */
  authorization: EIP3009Authorization

  /** EIP-712 signature of the authorization. */
  signature: string
}

/**
 * EIP-3009 transferWithAuthorization parameters.
 *
 * These map directly to the USDC contract function:
 * ```solidity
 * function transferWithAuthorization(
 *   address from,
 *   address to,
 *   uint256 value,
 *   uint256 validAfter,
 *   uint256 validBefore,
 *   bytes32 nonce,
 *   uint8 v, bytes32 r, bytes32 s
 * )
 * ```
 */
export interface EIP3009Authorization {
  /** Sender address (the agent's wallet). */
  from: string

  /** Recipient address (the API provider). */
  to: string

  /** Amount in USDC smallest unit (6 decimals). */
  value: string

  /** Unix timestamp — authorization is not valid before this time. */
  validAfter: number

  /** Unix timestamp — authorization expires after this time. */
  validBefore: number

  /** Unique 32-byte nonce (hex string) for replay protection. */
  nonce: string
}

// ---------------------------------------------------------------------------
// Facilitator
// ---------------------------------------------------------------------------

/**
 * Response from the x402 facilitator service after verification
 * and optional on-chain settlement.
 */
export interface FacilitatorResponse {
  /** Whether the payment was successfully verified/settled. */
  success: boolean

  /** On-chain transaction hash if settled. */
  transaction_hash?: string

  /** Error message if verification or settlement failed. */
  error?: string

  /** Block number of the settlement transaction. */
  block_number?: number
}

// ---------------------------------------------------------------------------
// Nonce Store
// ---------------------------------------------------------------------------

/**
 * Interface for nonce storage, used to prevent replay attacks.
 *
 * Each EIP-3009 authorization includes a unique nonce. Once a payment
 * is verified and settled, the nonce must be recorded so the same
 * authorization cannot be replayed.
 *
 * Implementations:
 * - InMemoryNonceStore: built-in, suitable for single-process servers
 * - Redis/DB-backed: recommended for production multi-process deployments
 */
export interface NonceStore {
  /** Check whether a nonce has already been used. */
  hasBeenUsed(nonce: string): Promise<boolean>

  /** Record a nonce as used. */
  markAsUsed(nonce: string): Promise<void>
}

// ---------------------------------------------------------------------------
// EIP-712 Typed Data
// ---------------------------------------------------------------------------

/**
 * EIP-712 domain separator parameters for USDC's transferWithAuthorization.
 */
export interface EIP712Domain {
  name: string
  version: string
  chainId: number
  verifyingContract: string
}

/**
 * Full EIP-712 typed data structure for signing.
 */
export interface EIP712TypedData {
  types: {
    EIP712Domain: Array<{ name: string; type: string }>
    TransferWithAuthorization: Array<{ name: string; type: string }>
  }
  primaryType: 'TransferWithAuthorization'
  domain: EIP712Domain
  message: {
    from: string
    to: string
    value: string
    validAfter: number
    validBefore: number
    nonce: string
  }
}
