import { describe, it, expect } from 'vitest'
import {
  deriveAddress,
  toUSDCSmallestUnit,
  buildAuthorization,
  signAuthorization,
  encodePayment,
  decodePayment,
  buildEIP712Domain,
  generateNonce,
} from '../eip3009.js'

// Well-known Hardhat/Anvil test private key #0
const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

// ---------------------------------------------------------------------------
// deriveAddress
// ---------------------------------------------------------------------------

describe('deriveAddress', () => {
  it('derives the correct Ethereum address from the Hardhat test private key', () => {
    const address = deriveAddress(TEST_PRIVATE_KEY)
    expect(address).toBe(TEST_ADDRESS)
  })

  it('works without the 0x prefix on the private key', () => {
    const address = deriveAddress(TEST_PRIVATE_KEY.slice(2))
    expect(address).toBe(TEST_ADDRESS)
  })

  it('returns a checksummed address (mixed case)', () => {
    const address = deriveAddress(TEST_PRIVATE_KEY)
    // Checksummed addresses have a mix of upper and lower hex chars
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/)
    // Verify it is not all-lowercase
    const hex = address.slice(2)
    expect(hex).not.toBe(hex.toLowerCase())
  })
})

// ---------------------------------------------------------------------------
// toUSDCSmallestUnit
// ---------------------------------------------------------------------------

describe('toUSDCSmallestUnit', () => {
  it('converts 0.01 to 10000', () => {
    expect(toUSDCSmallestUnit('0.01')).toBe('10000')
  })

  it('converts 1.00 to 1000000', () => {
    expect(toUSDCSmallestUnit('1.00')).toBe('1000000')
  })

  it('converts 100 (no decimals) to 100000000', () => {
    expect(toUSDCSmallestUnit('100')).toBe('100000000')
  })

  it('converts 0.000001 to 1', () => {
    expect(toUSDCSmallestUnit('0.000001')).toBe('1')
  })

  it('converts 0 to 0', () => {
    expect(toUSDCSmallestUnit('0')).toBe('0')
  })

  it('truncates beyond 6 decimal places', () => {
    // 0.0000019 should truncate to 0.000001 = 1
    expect(toUSDCSmallestUnit('0.0000019')).toBe('1')
  })
})

// ---------------------------------------------------------------------------
// buildAuthorization
// ---------------------------------------------------------------------------

describe('buildAuthorization', () => {
  const from = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
  const to = '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'

  it('returns an object with all required EIP-3009 fields', () => {
    const auth = buildAuthorization(from, to, '1.00', 300)

    expect(auth).toHaveProperty('from', from)
    expect(auth).toHaveProperty('to', to)
    expect(auth).toHaveProperty('value', '1000000')
    expect(typeof auth.validAfter).toBe('number')
    expect(typeof auth.validBefore).toBe('number')
    expect(typeof auth.nonce).toBe('string')
  })

  it('sets validAfter to 0', () => {
    const auth = buildAuthorization(from, to, '1.00', 300)
    expect(auth.validAfter).toBe(0)
  })

  it('sets validBefore to approximately now + timeout', () => {
    const before = Math.floor(Date.now() / 1000)
    const auth = buildAuthorization(from, to, '1.00', 300)
    const after = Math.floor(Date.now() / 1000)

    expect(auth.validBefore).toBeGreaterThanOrEqual(before + 300)
    expect(auth.validBefore).toBeLessThanOrEqual(after + 300)
  })

  it('generates a valid nonce', () => {
    const auth = buildAuthorization(from, to, '1.00', 300)
    expect(auth.nonce).toMatch(/^0x[0-9a-f]{64}$/)
  })
})

// ---------------------------------------------------------------------------
// signAuthorization
// ---------------------------------------------------------------------------

describe('signAuthorization', () => {
  it('produces a payment with scheme "exact"', () => {
    const auth = buildAuthorization(
      deriveAddress(TEST_PRIVATE_KEY),
      '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      '0.01',
      300,
    )
    const payment = signAuthorization(TEST_PRIVATE_KEY, 'base-sepolia', auth)
    expect(payment.scheme).toBe('exact')
  })

  it('produces a 65-byte hex signature (0x + 130 hex chars)', () => {
    const auth = buildAuthorization(
      deriveAddress(TEST_PRIVATE_KEY),
      '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      '0.01',
      300,
    )
    const payment = signAuthorization(TEST_PRIVATE_KEY, 'base-sepolia', auth)

    // 0x prefix + 64 hex (r) + 64 hex (s) + 2 hex (v) = 132 chars total
    expect(payment.signature).toMatch(/^0x[0-9a-fA-F]{130}$/)
    // That is 2 (prefix) + 130 = 132 chars
    expect(payment.signature.length).toBe(132)
  })

  it('includes the authorization and network in the payment', () => {
    const auth = buildAuthorization(
      deriveAddress(TEST_PRIVATE_KEY),
      '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      '0.01',
      300,
    )
    const payment = signAuthorization(TEST_PRIVATE_KEY, 'base-sepolia', auth)

    expect(payment.network).toBe('base-sepolia')
    expect(payment.authorization).toBe(auth)
  })

  it('produces a signature with v = 27 or 28', () => {
    const auth = buildAuthorization(
      deriveAddress(TEST_PRIVATE_KEY),
      '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      '0.01',
      300,
    )
    const payment = signAuthorization(TEST_PRIVATE_KEY, 'base-sepolia', auth)

    // Last byte is v (27 = 0x1b, 28 = 0x1c)
    const vHex = payment.signature.slice(-2)
    const v = parseInt(vHex, 16)
    expect(v === 27 || v === 28).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// encodePayment / decodePayment roundtrip
// ---------------------------------------------------------------------------

describe('encodePayment / decodePayment', () => {
  it('roundtrips a payment through encode and decode', () => {
    const auth = buildAuthorization(
      deriveAddress(TEST_PRIVATE_KEY),
      '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      '1.00',
      300,
    )
    const payment = signAuthorization(TEST_PRIVATE_KEY, 'base-sepolia', auth)

    const encoded = encodePayment(payment)
    expect(typeof encoded).toBe('string')

    const decoded = decodePayment(encoded)
    expect(decoded).toEqual(payment)
  })

  it('encodePayment returns a base64 string', () => {
    const auth = buildAuthorization(
      deriveAddress(TEST_PRIVATE_KEY),
      '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      '0.01',
      300,
    )
    const payment = signAuthorization(TEST_PRIVATE_KEY, 'base-sepolia', auth)
    const encoded = encodePayment(payment)

    // Base64 chars only
    expect(encoded).toMatch(/^[A-Za-z0-9+/]+=*$/)
  })

  it('decodePayment rejects invalid base64', () => {
    expect(() => decodePayment('not valid base64!!!')).toThrow('not valid')
  })

  it('decodePayment rejects non-JSON base64', () => {
    const encoded = Buffer.from('not json', 'utf-8').toString('base64')
    expect(() => decodePayment(encoded)).toThrow('not valid JSON')
  })

  it('decodePayment rejects missing scheme', () => {
    const encoded = Buffer.from(
      JSON.stringify({ authorization: {}, signature: '0x00' }),
      'utf-8',
    ).toString('base64')
    expect(() => decodePayment(encoded)).toThrow('unsupported scheme')
  })

  it('decodePayment rejects missing authorization', () => {
    const encoded = Buffer.from(
      JSON.stringify({ scheme: 'exact', signature: '0x00' }),
      'utf-8',
    ).toString('base64')
    expect(() => decodePayment(encoded)).toThrow('missing authorization')
  })

  it('decodePayment rejects missing signature', () => {
    const encoded = Buffer.from(
      JSON.stringify({ scheme: 'exact', authorization: { from: '0x0' } }),
      'utf-8',
    ).toString('base64')
    expect(() => decodePayment(encoded)).toThrow('missing signature')
  })
})

// ---------------------------------------------------------------------------
// buildEIP712Domain
// ---------------------------------------------------------------------------

describe('buildEIP712Domain', () => {
  it('returns correct domain for base-sepolia', () => {
    const domain = buildEIP712Domain('base-sepolia')
    expect(domain.name).toBe('USD Coin')
    expect(domain.version).toBe('2')
    expect(domain.chainId).toBe(84532)
    expect(domain.verifyingContract).toBe(
      '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    )
  })

  it('returns correct domain for base mainnet', () => {
    const domain = buildEIP712Domain('base')
    expect(domain.chainId).toBe(8453)
    expect(domain.verifyingContract).toBe(
      '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    )
  })

  it('throws for unsupported networks', () => {
    expect(() => buildEIP712Domain('ethereum')).toThrow('Unsupported network')
  })
})

// ---------------------------------------------------------------------------
// generateNonce
// ---------------------------------------------------------------------------

describe('generateNonce', () => {
  it('produces a 0x-prefixed 66-char hex string', () => {
    const nonce = generateNonce()
    expect(nonce).toMatch(/^0x[0-9a-f]{64}$/)
    expect(nonce.length).toBe(66)
  })

  it('generates unique nonces on successive calls', () => {
    const a = generateNonce()
    const b = generateNonce()
    expect(a).not.toBe(b)
  })
})
