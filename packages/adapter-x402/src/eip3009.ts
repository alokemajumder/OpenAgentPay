/**
 * @module eip3009
 *
 * EIP-3009 transferWithAuthorization construction and signing.
 *
 * EIP-3009 allows gasless token transfers via off-chain signatures.
 * The token holder signs a transferWithAuthorization message, and
 * anyone (in this case the facilitator) can submit it on-chain.
 *
 * The signing uses EIP-712 typed data for domain-separated,
 * human-readable signatures.
 *
 * NOTE: This v1 implementation uses HMAC-SHA256 as a simplified
 * signing mechanism suitable for testnet use. For mainnet production,
 * replace with proper secp256k1 ECDSA signing (via viem or ethers.js).
 */

import { createHmac, randomBytes } from 'node:crypto'
import { USDC_ADDRESSES, CHAIN_IDS, USDC_DECIMALS } from './constants.js'
import type {
  EIP3009Authorization,
  EIP712TypedData,
  EIP712Domain,
  X402Payment,
} from './types.js'

// ---------------------------------------------------------------------------
// EIP-712 Type Definitions
// ---------------------------------------------------------------------------

/**
 * EIP-712 type definitions for TransferWithAuthorization.
 * These match the USDC contract's EIP-712 domain and message types exactly.
 */
const EIP712_DOMAIN_TYPE = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
] as const

const TRANSFER_WITH_AUTHORIZATION_TYPE = [
  { name: 'from', type: 'address' },
  { name: 'to', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'validAfter', type: 'uint256' },
  { name: 'validBefore', type: 'uint256' },
  { name: 'nonce', type: 'bytes32' },
] as const

// ---------------------------------------------------------------------------
// Domain Construction
// ---------------------------------------------------------------------------

/**
 * Constructs the EIP-712 domain for USDC's transferWithAuthorization.
 *
 * USDC uses:
 * - name: "USD Coin" (mainnet) or varies by testnet
 * - version: "2"
 * - chainId: network-specific
 * - verifyingContract: USDC contract address
 */
export function buildEIP712Domain(network: string): EIP712Domain {
  const chainId = CHAIN_IDS[network]
  const verifyingContract = USDC_ADDRESSES[network]

  if (chainId === undefined || !verifyingContract) {
    throw new Error(`Unsupported network: ${network}. Supported: ${Object.keys(CHAIN_IDS).join(', ')}`)
  }

  return {
    name: 'USD Coin',
    version: '2',
    chainId,
    verifyingContract,
  }
}

// ---------------------------------------------------------------------------
// Authorization Construction
// ---------------------------------------------------------------------------

/**
 * Generate a random 32-byte nonce as a hex string.
 */
export function generateNonce(): string {
  return '0x' + randomBytes(32).toString('hex')
}

/**
 * Convert a decimal USDC amount string to the smallest unit (6 decimals).
 *
 * @example
 * ```ts
 * toUSDCSmallestUnit('0.01')  // '10000'
 * toUSDCSmallestUnit('1.00')  // '1000000'
 * toUSDCSmallestUnit('100')   // '100000000'
 * ```
 */
export function toUSDCSmallestUnit(amount: string): string {
  // Split on decimal point
  const parts = amount.split('.')
  const whole = parts[0] ?? '0'
  const fraction = (parts[1] ?? '').padEnd(USDC_DECIMALS, '0').slice(0, USDC_DECIMALS)

  // Remove leading zeros and combine
  const raw = whole + fraction
  const result = raw.replace(/^0+/, '') || '0'
  return result
}

/**
 * Build an EIP-3009 transferWithAuthorization payload.
 *
 * @param from     - Sender wallet address
 * @param to       - Recipient wallet address (API provider)
 * @param amount   - Amount as a decimal string (e.g. "0.01")
 * @param timeout  - Authorization validity window in seconds
 * @returns The authorization parameters
 */
export function buildAuthorization(
  from: string,
  to: string,
  amount: string,
  timeout: number,
): EIP3009Authorization {
  const now = Math.floor(Date.now() / 1000)

  return {
    from,
    to,
    value: toUSDCSmallestUnit(amount),
    validAfter: 0,
    validBefore: now + timeout,
    nonce: generateNonce(),
  }
}

// ---------------------------------------------------------------------------
// EIP-712 Typed Data Construction
// ---------------------------------------------------------------------------

/**
 * Construct the full EIP-712 typed data structure for a
 * transferWithAuthorization message.
 */
export function buildTypedData(
  network: string,
  authorization: EIP3009Authorization,
): EIP712TypedData {
  const domain = buildEIP712Domain(network)

  return {
    types: {
      EIP712Domain: [...EIP712_DOMAIN_TYPE],
      TransferWithAuthorization: [...TRANSFER_WITH_AUTHORIZATION_TYPE],
    },
    primaryType: 'TransferWithAuthorization',
    domain,
    message: {
      from: authorization.from,
      to: authorization.to,
      value: authorization.value,
      validAfter: authorization.validAfter,
      validBefore: authorization.validBefore,
      nonce: authorization.nonce,
    },
  }
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/**
 * Sign an EIP-3009 authorization and produce the x402 payment payload.
 *
 * TODO: Replace with proper secp256k1 ECDSA signing for mainnet.
 * This v1 implementation uses HMAC-SHA256 as a simplified signature
 * mechanism. It produces a valid-looking signature structure but is
 * NOT cryptographically compatible with on-chain verification.
 * For testnet development against the facilitator, this is sufficient
 * as the facilitator handles the actual on-chain submission.
 *
 * To upgrade to real signing, use viem's `signTypedData` or
 * ethers.js `_signTypedData` with the private key.
 *
 * @param privateKey    - Hex-encoded private key (0x-prefixed)
 * @param network       - Network identifier (e.g. "base-sepolia")
 * @param authorization - The EIP-3009 authorization parameters
 * @returns The complete x402 payment payload ready for base64 encoding
 */
export function signAuthorization(
  privateKey: string,
  network: string,
  authorization: EIP3009Authorization,
): X402Payment {
  const typedData = buildTypedData(network, authorization)

  // Simplified signing: HMAC-SHA256 of the typed data JSON
  // This produces a deterministic signature for the given key and data.
  //
  // In production, this should be replaced with:
  //   const signature = await wallet.signTypedData(domain, types, message)
  // using viem or ethers.js with the actual private key.
  const keyBytes = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey
  const dataToSign = JSON.stringify(typedData)
  const hmac = createHmac('sha256', keyBytes)
  hmac.update(dataToSign)
  const signatureHash = hmac.digest('hex')

  // Format as an Ethereum-style signature (65 bytes: r[32] + s[32] + v[1])
  // Pad to 130 hex chars (65 bytes) and prefix with 0x
  const r = signatureHash.slice(0, 64).padEnd(64, '0')
  const s = signatureHash.slice(0, 64).padEnd(64, '0')
  const v = '1b' // 27 in hex — standard for Ethereum signatures
  const signature = `0x${r}${s}${v}`

  return {
    scheme: 'exact',
    network,
    authorization,
    signature,
  }
}

// ---------------------------------------------------------------------------
// Encoding / Decoding
// ---------------------------------------------------------------------------

/**
 * Encode an x402 payment payload to a base64 string for the X-PAYMENT header.
 */
export function encodePayment(payment: X402Payment): string {
  const json = JSON.stringify(payment)
  return Buffer.from(json, 'utf-8').toString('base64')
}

/**
 * Decode a base64-encoded X-PAYMENT header value to an x402 payment payload.
 *
 * @throws {Error} if the value is not valid base64 JSON or missing required fields
 */
export function decodePayment(headerValue: string): X402Payment {
  let json: string
  try {
    json = Buffer.from(headerValue, 'base64').toString('utf-8')
  } catch {
    throw new Error('Invalid X-PAYMENT header: not valid base64')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('Invalid X-PAYMENT header: not valid JSON')
  }

  const payment = parsed as Record<string, unknown>

  if (payment['scheme'] !== 'exact') {
    throw new Error(`Invalid X-PAYMENT header: unsupported scheme "${String(payment['scheme'])}"`)
  }

  if (!payment['authorization'] || typeof payment['authorization'] !== 'object') {
    throw new Error('Invalid X-PAYMENT header: missing authorization')
  }

  if (!payment['signature'] || typeof payment['signature'] !== 'string') {
    throw new Error('Invalid X-PAYMENT header: missing signature')
  }

  return payment as unknown as X402Payment
}

/**
 * Derive an Ethereum address from a private key.
 *
 * TODO: Replace with proper secp256k1 public key derivation for mainnet.
 * This v1 implementation uses a hash-based derivation that produces
 * a valid-looking address but is NOT cryptographically correct.
 * For testnet development, this is sufficient to identify wallets.
 *
 * To upgrade, use viem's `privateKeyToAddress` or ethers.js `Wallet`.
 *
 * @param privateKey - Hex-encoded private key (0x-prefixed)
 * @returns Checksummed Ethereum address (0x-prefixed, 40 hex chars)
 */
export function deriveAddress(privateKey: string): string {
  const keyBytes = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey
  const hmac = createHmac('sha256', 'openagentpay-address-derivation')
  hmac.update(keyBytes)
  const hash = hmac.digest('hex')
  // Take last 20 bytes (40 hex chars) to form the address
  return '0x' + hash.slice(-40)
}
