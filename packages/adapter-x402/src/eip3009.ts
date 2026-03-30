/**
 * @module eip3009
 *
 * EIP-3009 transferWithAuthorization construction and signing.
 *
 * EIP-3009 allows gasless token transfers via off-chain signatures.
 * The token holder signs a transferWithAuthorization message, and
 * anyone (in this case the facilitator) can submit it on-chain.
 *
 * Uses EIP-712 typed data signing with secp256k1 ECDSA for
 * production-ready on-chain verification.
 */

import { randomBytes, sign as cryptoSign, createPublicKey, createPrivateKey } from 'node:crypto'
import { USDC_ADDRESSES, CHAIN_IDS, USDC_DECIMALS } from './constants.js'
import type {
  EIP3009Authorization,
  EIP712TypedData,
  EIP712Domain,
  X402Payment,
} from './types.js'

// ---------------------------------------------------------------------------
// Hex Utilities
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0')
  }
  return hex
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  let totalLen = 0
  for (const arr of arrays) totalLen += arr.length
  const result = new Uint8Array(totalLen)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

function utf8ToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str)
}

// ---------------------------------------------------------------------------
// EIP-712 Type Definitions
// ---------------------------------------------------------------------------

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
// Keccak-256 (pure Uint8Array implementation)
// ---------------------------------------------------------------------------

const KECCAK_ROUNDS = 24
const KECCAK_RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
]

const KECCAK_ROTC = [
  1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44,
]

const KECCAK_PILN = [
  10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1,
]

function keccakF1600(state: BigUint64Array): void {
  for (let round = 0; round < KECCAK_ROUNDS; round++) {
    const c = new BigUint64Array(5)
    for (let x = 0; x < 5; x++) {
      c[x] = state[x]! ^ state[x + 5]! ^ state[x + 10]! ^ state[x + 15]! ^ state[x + 20]!
    }
    const d = new BigUint64Array(5)
    for (let x = 0; x < 5; x++) {
      d[x] = c[(x + 4) % 5]! ^ ((c[(x + 1) % 5]! << 1n) | (c[(x + 1) % 5]! >> 63n))
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        state[x + y * 5] ^= d[x]!
      }
    }

    let current = state[1]!
    for (let i = 0; i < 24; i++) {
      const j = KECCAK_PILN[i]!
      const temp = state[j]!
      const rot = KECCAK_ROTC[i]!
      state[j] = (current << BigInt(rot)) | (current >> BigInt(64 - rot))
      current = temp
    }

    const tmp = new BigUint64Array(5)
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        tmp[x] = state[x + y * 5]!
      }
      for (let x = 0; x < 5; x++) {
        state[x + y * 5] = tmp[x]! ^ (~tmp[(x + 1) % 5]! & tmp[(x + 2) % 5]!)
      }
    }

    state[0] ^= KECCAK_RC[round]!
  }
}

/**
 * Keccak-256 hash function (NOT SHA3-256; uses 0x01 padding).
 */
function keccak256(data: Uint8Array): Uint8Array {
  const rate = 136
  const state = new BigUint64Array(25)

  let offset = 0
  while (offset + rate <= data.length) {
    const view = new DataView(data.buffer, data.byteOffset + offset, rate)
    for (let i = 0; i < rate / 8; i++) {
      state[i] ^= view.getBigUint64(i * 8, true)
    }
    keccakF1600(state)
    offset += rate
  }

  const remaining = data.length - offset
  const padded = new Uint8Array(rate)
  padded.set(data.subarray(offset))
  padded[remaining] = 0x01
  padded[rate - 1] |= 0x80

  const padView = new DataView(padded.buffer, padded.byteOffset, rate)
  for (let i = 0; i < rate / 8; i++) {
    state[i] ^= padView.getBigUint64(i * 8, true)
  }
  keccakF1600(state)

  const output = new Uint8Array(32)
  const outView = new DataView(output.buffer, output.byteOffset, 32)
  for (let i = 0; i < 4; i++) {
    outView.setBigUint64(i * 8, state[i]!, true)
  }
  return output
}

// ---------------------------------------------------------------------------
// ABI Encoding Helpers
// ---------------------------------------------------------------------------

function encodeUint256(value: bigint | number | string): Uint8Array {
  const buf = new Uint8Array(32)
  let n = BigInt(value)
  for (let i = 31; i >= 0; i--) {
    buf[i] = Number(n & 0xffn)
    n >>= 8n
  }
  return buf
}

function encodeAddress(addr: string): Uint8Array {
  const hex = addr.startsWith('0x') ? addr.slice(2) : addr
  const buf = new Uint8Array(32)
  const addrBytes = hexToBytes(hex)
  buf.set(addrBytes, 12)
  return buf
}

function encodeBytes32(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  return hexToBytes(clean.padEnd(64, '0'))
}

function encodeString(str: string): Uint8Array {
  return keccak256(utf8ToBytes(str))
}

// ---------------------------------------------------------------------------
// EIP-712 Hashing
// ---------------------------------------------------------------------------

function hashDomain(domain: EIP712Domain): Uint8Array {
  const typeHash = keccak256(
    utf8ToBytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')
  )
  return keccak256(concatBytes(
    typeHash,
    encodeString(domain.name),
    encodeString(domain.version),
    encodeUint256(domain.chainId),
    encodeAddress(domain.verifyingContract),
  ))
}

function hashMessage(message: EIP712TypedData['message']): Uint8Array {
  const typeHash = keccak256(
    utf8ToBytes('TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)')
  )
  return keccak256(concatBytes(
    typeHash,
    encodeAddress(message.from),
    encodeAddress(message.to),
    encodeUint256(message.value),
    encodeUint256(message.validAfter),
    encodeUint256(message.validBefore),
    encodeBytes32(message.nonce),
  ))
}

function eip712Digest(typedData: EIP712TypedData): Uint8Array {
  const domainHash = hashDomain(typedData.domain)
  const messageHash = hashMessage(typedData.message)
  return keccak256(concatBytes(
    new Uint8Array([0x19, 0x01]),
    domainHash,
    messageHash,
  ))
}

// ---------------------------------------------------------------------------
// Domain Construction
// ---------------------------------------------------------------------------

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

export function generateNonce(): string {
  return '0x' + randomBytes(32).toString('hex')
}

export function toUSDCSmallestUnit(amount: string): string {
  const parts = amount.split('.')
  const whole = parts[0] ?? '0'
  const fraction = (parts[1] ?? '').padEnd(USDC_DECIMALS, '0').slice(0, USDC_DECIMALS)
  const raw = whole + fraction
  const result = raw.replace(/^0+/, '') || '0'
  return result
}

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
// secp256k1 ECDSA Signing
// ---------------------------------------------------------------------------

const SECP256K1_ORDER = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n

function buildSecpPrivateKey(keyHex: string) {
  const clean = keyHex.startsWith('0x') ? keyHex.slice(2) : keyHex
  const keyBuf = hexToBytes(clean)
  const derBytes = concatBytes(
    hexToBytes('302e0201010420'),
    keyBuf,
    hexToBytes('a00706052b8104000a'),
  )
  return createPrivateKey({
    key: Buffer.from(derBytes),
    format: 'der',
    type: 'sec1',
  })
}

function ecdsaSign(hash: Uint8Array, privateKeyHex: string): { r: string; s: string; v: number } {
  const privKey = buildSecpPrivateKey(privateKeyHex)

  // Node.js crypto.sign accepts Uint8Array at runtime; cast for TS DOM lib compat
  const sig = cryptoSign(null, hash as never, {
    key: privKey,
    dsaEncoding: 'ieee-p1363',
  }) as unknown as Uint8Array

  const rBytes = sig.slice(0, 32)
  const sBytes = sig.slice(32, 64)

  const r = bytesToHex(rBytes)
  let sBigInt = BigInt('0x' + bytesToHex(sBytes))
  const halfOrder = SECP256K1_ORDER / 2n

  let v = 27
  if (sBigInt > halfOrder) {
    sBigInt = SECP256K1_ORDER - sBigInt
    v = 28
  }

  const s = sBigInt.toString(16).padStart(64, '0')

  return { r, s, v }
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/**
 * Sign an EIP-3009 authorization and produce the x402 payment payload.
 *
 * Uses secp256k1 ECDSA signing with EIP-712 typed data hashing
 * for production-ready on-chain verification.
 */
export function signAuthorization(
  privateKey: string,
  network: string,
  authorization: EIP3009Authorization,
): X402Payment {
  const typedData = buildTypedData(network, authorization)
  const digest = eip712Digest(typedData)
  const { r, s, v } = ecdsaSign(digest, privateKey)
  const vHex = v.toString(16).padStart(2, '0')
  const signature = `0x${r}${s}${vHex}`

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

export function encodePayment(payment: X402Payment): string {
  const json = JSON.stringify(payment)
  return Buffer.from(json, 'utf-8').toString('base64')
}

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

// ---------------------------------------------------------------------------
// Address Derivation
// ---------------------------------------------------------------------------

/**
 * Derive an Ethereum address from a secp256k1 private key.
 *
 * Uses Node.js crypto to derive the public key, then keccak256
 * of the uncompressed key (minus 0x04 prefix), last 20 bytes.
 */
export function deriveAddress(privateKey: string): string {
  const privKey = buildSecpPrivateKey(privateKey)

  const pubKey = createPublicKey(privKey)
  const spkiBuf = pubKey.export({ type: 'spki', format: 'der' })

  // Extract raw 65-byte uncompressed public key from SPKI — copy to plain Uint8Array
  const rawPubKey = new Uint8Array(65)
  for (let i = 0; i < 65; i++) {
    rawPubKey[i] = spkiBuf[spkiBuf.length - 65 + i]!
  }

  // keccak256(pubkey without 0x04 prefix), last 20 bytes
  const hash = keccak256(rawPubKey.subarray(1))
  const addressHex = bytesToHex(hash.subarray(12))

  return toChecksumAddress(addressHex)
}

function toChecksumAddress(addressHex: string): string {
  const lower = addressHex.toLowerCase()
  const hashHex = bytesToHex(keccak256(utf8ToBytes(lower)))

  let checksummed = '0x'
  for (let i = 0; i < 40; i++) {
    if (parseInt(hashHex[i]!, 16) >= 8) {
      checksummed += lower[i]!.toUpperCase()
    } else {
      checksummed += lower[i]
    }
  }
  return checksummed
}
