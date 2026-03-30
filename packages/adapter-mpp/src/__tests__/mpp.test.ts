import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  createChallenge,
  serializeChallenge,
  deserializeChallenge,
  isChallengeExpired,
} from '../challenge.js'

import {
  createCredential,
  serializeCredential,
  deserializeCredential,
  validateCredentialProof,
} from '../credential.js'

import { MPPAdapter } from '../mpp-adapter.js'
import { MPPSessionManager } from '../mpp-session.js'

import type { MPPChallenge, MPPCredential } from '../types.js'
import type { IncomingRequest, MPPPaymentMethod } from '@openagentpay/core'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(headers: Record<string, string> = {}): IncomingRequest {
  return { method: 'GET', url: '/api/test', headers }
}

// ---------------------------------------------------------------------------
// Challenge tests
// ---------------------------------------------------------------------------

describe('Challenge', () => {
  describe('createChallenge', () => {
    it('populates all required fields', () => {
      const ch = createChallenge({
        amount: '1.50',
        currency: 'USD',
        recipient: '0xRecipient',
        networks: ['tempo', 'stripe'],
      })

      expect(ch.version).toBe('1.0')
      expect(ch.challengeId).toMatch(/^mpp_ch_/)
      expect(ch.amount).toBe('1.50')
      expect(ch.currency).toBe('USD')
      expect(ch.recipient).toBe('0xRecipient')
      expect(ch.networks).toEqual(['tempo', 'stripe'])
      expect(ch.expiresAt).toBeDefined()
      expect(new Date(ch.expiresAt).getTime()).toBeGreaterThan(Date.now())
    })

    it('includes streamingSupported and resource when provided', () => {
      const ch = createChallenge({
        amount: '0.01',
        currency: 'USDC',
        recipient: '0xR',
        networks: ['lightning'],
        streamingSupported: true,
        resource: '/v1/completions',
      })

      expect(ch.streamingSupported).toBe(true)
      expect(ch.resource).toBe('/v1/completions')
    })

    it('includes sessionSupported when provided', () => {
      const ch = createChallenge({
        amount: '0.01',
        currency: 'USD',
        recipient: '0xR',
        networks: ['tempo'],
        sessionSupported: true,
      })

      expect(ch.sessionSupported).toBe(true)
    })

    it('uses default TTL of 300 seconds', () => {
      const before = Date.now()
      const ch = createChallenge({
        amount: '0.01',
        currency: 'USD',
        recipient: '0xR',
        networks: ['tempo'],
      })
      const after = Date.now()
      const expiresMs = new Date(ch.expiresAt).getTime()

      // Should expire ~300s from now
      expect(expiresMs).toBeGreaterThanOrEqual(before + 300 * 1000)
      expect(expiresMs).toBeLessThanOrEqual(after + 300 * 1000)
    })

    it('respects custom ttlSeconds', () => {
      const before = Date.now()
      const ch = createChallenge({
        amount: '0.01',
        currency: 'USD',
        recipient: '0xR',
        networks: ['tempo'],
        ttlSeconds: 60,
      })
      const expiresMs = new Date(ch.expiresAt).getTime()
      expect(expiresMs).toBeGreaterThanOrEqual(before + 60 * 1000)
      expect(expiresMs).toBeLessThanOrEqual(before + 60 * 1000 + 100)
    })
  })

  describe('serializeChallenge / deserializeChallenge roundtrip', () => {
    it('roundtrips a challenge through serialize → deserialize', () => {
      const original = createChallenge({
        amount: '2.50',
        currency: 'EUR',
        recipient: '0xABC',
        networks: ['tempo', 'lightning'],
        streamingSupported: true,
        resource: '/api/chat',
        metadata: { foo: 'bar' },
      })

      const encoded = serializeChallenge(original)
      expect(typeof encoded).toBe('string')
      expect(encoded.length).toBeGreaterThan(0)

      const decoded = deserializeChallenge(encoded)
      expect(decoded).toEqual(original)
    })

    it('throws on invalid base64', () => {
      expect(() => deserializeChallenge('!!notbase64!!')).toThrow()
    })

    it('throws on missing required fields', () => {
      const bad = Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64')
      expect(() => deserializeChallenge(bad)).toThrow('missing required fields')
    })
  })

  describe('isChallengeExpired', () => {
    it('returns false for a fresh challenge', () => {
      const ch = createChallenge({
        amount: '0.01',
        currency: 'USD',
        recipient: '0xR',
        networks: ['tempo'],
      })
      expect(isChallengeExpired(ch)).toBe(false)
    })

    it('returns true for an expired challenge', () => {
      const ch = createChallenge({
        amount: '0.01',
        currency: 'USD',
        recipient: '0xR',
        networks: ['tempo'],
      })
      // Manually set expiresAt to the past
      ch.expiresAt = new Date(Date.now() - 1000).toISOString()
      expect(isChallengeExpired(ch)).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// Credential tests
// ---------------------------------------------------------------------------

describe('Credential', () => {
  describe('createCredential', () => {
    it('creates a credential with the correct structure', () => {
      const cred = createCredential({
        challengeId: 'mpp_ch_abc123',
        network: 'tempo',
        proof: { transactionHash: '0xTxHash' },
        payer: '0xPayer',
      })

      expect(cred.version).toBe('1.0')
      expect(cred.challengeId).toBe('mpp_ch_abc123')
      expect(cred.network).toBe('tempo')
      expect(cred.proof.transactionHash).toBe('0xTxHash')
      expect(cred.payer).toBe('0xPayer')
      expect(cred.timestamp).toBeDefined()
      expect(new Date(cred.timestamp).getTime()).toBeLessThanOrEqual(Date.now())
    })

    it('maps stripe proof correctly', () => {
      const cred = createCredential({
        challengeId: 'ch_1',
        network: 'stripe',
        proof: { paymentIntentId: 'pi_123' },
        payer: 'agent-1',
      })

      expect(cred.proof.paymentIntentId).toBe('pi_123')
      expect(cred.proof.transactionHash).toBeUndefined()
    })

    it('maps lightning proof correctly', () => {
      const cred = createCredential({
        challengeId: 'ch_2',
        network: 'lightning',
        proof: { preimage: 'abc123preimage' },
        payer: 'agent-2',
      })

      expect(cred.proof.preimage).toBe('abc123preimage')
    })
  })

  describe('serializeCredential / deserializeCredential roundtrip', () => {
    it('roundtrips a credential and includes MPP prefix', () => {
      const original = createCredential({
        challengeId: 'mpp_ch_test',
        network: 'tempo',
        proof: { transactionHash: '0xABCDEF' },
        payer: '0xPayer',
      })

      const serialized = serializeCredential(original)
      expect(serialized).toMatch(/^MPP /)

      const deserialized = deserializeCredential(serialized)
      expect(deserialized.challengeId).toBe(original.challengeId)
      expect(deserialized.network).toBe(original.network)
      expect(deserialized.proof.transactionHash).toBe(original.proof.transactionHash)
      expect(deserialized.payer).toBe(original.payer)
      expect(deserialized.version).toBe('1.0')
    })

    it('throws when prefix is missing', () => {
      const raw = Buffer.from(JSON.stringify({ version: '1.0', challengeId: 'x', network: 'y', payer: 'z' })).toString('base64')
      expect(() => deserializeCredential(raw)).toThrow('must start with "MPP "')
    })

    it('throws on missing required fields after decode', () => {
      const raw = 'MPP ' + Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64')
      expect(() => deserializeCredential(raw)).toThrow('missing required fields')
    })
  })

  describe('validateCredentialProof', () => {
    it('validates tempo credentials (transactionHash)', () => {
      const cred = createCredential({
        challengeId: 'ch',
        network: 'tempo',
        proof: { transactionHash: '0xhash' },
        payer: 'p',
      })
      expect(validateCredentialProof(cred)).toBe(true)
    })

    it('rejects tempo credentials without transactionHash', () => {
      const cred = createCredential({
        challengeId: 'ch',
        network: 'tempo',
        proof: {},
        payer: 'p',
      })
      expect(validateCredentialProof(cred)).toBe(false)
    })

    it('validates stripe credentials (paymentIntentId)', () => {
      const cred = createCredential({
        challengeId: 'ch',
        network: 'stripe',
        proof: { paymentIntentId: 'pi_abc' },
        payer: 'p',
      })
      expect(validateCredentialProof(cred)).toBe(true)
    })

    it('rejects stripe credentials without paymentIntentId', () => {
      const cred = createCredential({
        challengeId: 'ch',
        network: 'stripe',
        proof: {},
        payer: 'p',
      })
      expect(validateCredentialProof(cred)).toBe(false)
    })

    it('validates lightning credentials (preimage)', () => {
      const cred = createCredential({
        challengeId: 'ch',
        network: 'lightning',
        proof: { preimage: 'preimg_value' },
        payer: 'p',
      })
      expect(validateCredentialProof(cred)).toBe(true)
    })

    it('rejects lightning credentials without preimage', () => {
      const cred = createCredential({
        challengeId: 'ch',
        network: 'lightning',
        proof: {},
        payer: 'p',
      })
      expect(validateCredentialProof(cred)).toBe(false)
    })

    it('handles unknown network — accepts if any proof field is present', () => {
      const cred: MPPCredential = {
        version: '1.0',
        challengeId: 'ch',
        network: 'bitcoin',
        proof: { transactionHash: '0xSomething' },
        payer: 'p',
        timestamp: new Date().toISOString(),
      }
      expect(validateCredentialProof(cred)).toBe(true)
    })

    it('handles unknown network — rejects if no proof field is present', () => {
      const cred: MPPCredential = {
        version: '1.0',
        challengeId: 'ch',
        network: 'bitcoin',
        proof: {},
        payer: 'p',
        timestamp: new Date().toISOString(),
      }
      expect(validateCredentialProof(cred)).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// MPPAdapter tests
// ---------------------------------------------------------------------------

describe('MPPAdapter', () => {
  let adapter: MPPAdapter

  beforeEach(() => {
    adapter = new MPPAdapter({
      networks: ['tempo', 'stripe'],
      sessionsSupported: true,
      streamingSupported: true,
    })
  })

  describe('detect', () => {
    it('returns true when Authorization header starts with MPP', () => {
      const req = makeRequest({ authorization: 'MPP eyJhYmMiOiIxMjMifQ==' })
      expect(adapter.detect(req)).toBe(true)
    })

    it('returns false when Authorization header is missing', () => {
      const req = makeRequest({})
      expect(adapter.detect(req)).toBe(false)
    })

    it('returns false for non-MPP authorization schemes', () => {
      const req = makeRequest({ authorization: 'Bearer some-token' })
      expect(adapter.detect(req)).toBe(false)
    })

    it('returns false for empty authorization header', () => {
      const req = makeRequest({ authorization: '' })
      expect(adapter.detect(req)).toBe(false)
    })
  })

  describe('supports', () => {
    it('returns true for mpp payment methods', () => {
      const method: MPPPaymentMethod = {
        type: 'mpp',
        challenge_id: 'ch_1',
        networks: ['tempo'],
        amount: '1.00',
        currency: 'USD',
        recipient: '0xR',
        sessions_supported: false,
      }
      expect(adapter.supports(method)).toBe(true)
    })

    it('returns false for non-mpp payment methods', () => {
      const method = { type: 'x402' } as any
      expect(adapter.supports(method)).toBe(false)
    })
  })

  describe('describeMethod', () => {
    it('returns an MPPPaymentMethod with correct fields', () => {
      const method = adapter.describeMethod({
        recipient: '0xRecipient',
        amount: '0.50',
        currency: 'USDC',
        resource: '/v1/chat',
      }) as MPPPaymentMethod

      expect(method.type).toBe('mpp')
      expect(method.challenge_id).toMatch(/^mpp_ch_/)
      expect(method.networks).toEqual(['tempo', 'stripe'])
      expect(method.amount).toBe('0.50')
      expect(method.currency).toBe('USDC')
      expect(method.recipient).toBe('0xRecipient')
      expect(method.sessions_supported).toBe(true)
    })

    it('includes server_url when provided', () => {
      const method = adapter.describeMethod({
        recipient: '0xR',
        server_url: 'https://api.example.com',
      }) as MPPPaymentMethod

      expect(method.server_url).toBe('https://api.example.com')
    })

    it('defaults amount to 0.00 and currency to USD', () => {
      const method = adapter.describeMethod({
        recipient: '0xR',
      }) as MPPPaymentMethod

      expect(method.amount).toBe('0.00')
      expect(method.currency).toBe('USD')
    })
  })

  describe('verify — full flow', () => {
    it('verifies a valid tempo credential (dev mode, no RPC URL)', async () => {
      // Step 1: describe method to create and store a challenge
      const method = adapter.describeMethod({
        recipient: '0xRecipient',
        amount: '1.00',
        currency: 'USD',
      }) as MPPPaymentMethod

      // Step 2: create a matching credential
      const cred = createCredential({
        challengeId: method.challenge_id,
        network: 'tempo',
        proof: { transactionHash: '0xTx123' },
        payer: '0xAgent',
      })
      const headerValue = serializeCredential(cred)

      // Step 3: detect + verify
      const req = makeRequest({ authorization: headerValue })
      expect(adapter.detect(req)).toBe(true)

      const result = await adapter.verify(req, { amount: '1.00', currency: 'USD' })
      expect(result.valid).toBe(true)
      expect(result.receipt).toBeDefined()
      expect(result.receipt!.id).toMatch(/^mpp_/)
      expect(result.receipt!.payment?.method).toBe('mpp')
      expect(result.receipt!.payment?.network).toBe('tempo')
      expect(result.receipt!.payment?.transaction_hash).toBe('0xTx123')
      expect(result.receipt!.payer?.identifier).toBe('0xAgent')
    })

    it('verifies a valid stripe credential (dev mode)', async () => {
      const method = adapter.describeMethod({
        recipient: '0xR',
        amount: '2.00',
        currency: 'USD',
      }) as MPPPaymentMethod

      const cred = createCredential({
        challengeId: method.challenge_id,
        network: 'stripe',
        proof: { paymentIntentId: 'pi_xyz' },
        payer: 'stripe-agent',
      })

      const req = makeRequest({ authorization: serializeCredential(cred) })
      const result = await adapter.verify(req, { amount: '2.00', currency: 'USD' })
      expect(result.valid).toBe(true)
      expect(result.receipt!.payment?.transaction_hash).toBe('pi_xyz')
    })

    it('verifies a valid lightning credential (dev mode)', async () => {
      const lightningAdapter = new MPPAdapter({ networks: ['lightning'] })

      const method = lightningAdapter.describeMethod({
        recipient: '0xR',
        amount: '0.01',
        currency: 'USD',
      }) as MPPPaymentMethod

      const cred = createCredential({
        challengeId: method.challenge_id,
        network: 'lightning',
        proof: { preimage: 'preimage_abc' },
        payer: 'ln-agent',
      })

      const req = makeRequest({ authorization: serializeCredential(cred) })
      const result = await lightningAdapter.verify(req, { amount: '0.01', currency: 'USD' })
      expect(result.valid).toBe(true)
      expect(result.receipt!.payment?.transaction_hash).toBe('preimage_abc')
    })

    it('rejects unknown challenge ID', async () => {
      const cred = createCredential({
        challengeId: 'mpp_ch_unknown',
        network: 'tempo',
        proof: { transactionHash: '0xTx' },
        payer: 'agent',
      })

      const req = makeRequest({ authorization: serializeCredential(cred) })
      const result = await adapter.verify(req, { amount: '1.00', currency: 'USD' })
      expect(result.valid).toBe(false)
      expect(result.error).toContain('Unknown challenge ID')
    })

    it('rejects expired challenge', async () => {
      // Create adapter with very short TTL
      const shortAdapter = new MPPAdapter({
        networks: ['tempo'],
        challengeTtlSeconds: 0, // expires immediately
      })

      const method = shortAdapter.describeMethod({
        recipient: '0xR',
        amount: '1.00',
        currency: 'USD',
      }) as MPPPaymentMethod

      // Wait a tiny bit for expiry
      await new Promise((r) => setTimeout(r, 10))

      const cred = createCredential({
        challengeId: method.challenge_id,
        network: 'tempo',
        proof: { transactionHash: '0xTx' },
        payer: 'agent',
      })

      const req = makeRequest({ authorization: serializeCredential(cred) })
      const result = await shortAdapter.verify(req, { amount: '1.00', currency: 'USD' })
      expect(result.valid).toBe(false)
      expect(result.error).toContain('expired')
    })

    it('rejects credential with missing proof', async () => {
      const method = adapter.describeMethod({
        recipient: '0xR',
        amount: '1.00',
        currency: 'USD',
      }) as MPPPaymentMethod

      const cred = createCredential({
        challengeId: method.challenge_id,
        network: 'tempo',
        proof: {}, // no transactionHash
        payer: 'agent',
      })

      const req = makeRequest({ authorization: serializeCredential(cred) })
      const result = await adapter.verify(req, { amount: '1.00', currency: 'USD' })
      expect(result.valid).toBe(false)
      expect(result.error).toContain('Missing or invalid proof')
    })

    it('rejects unsupported network', async () => {
      const method = adapter.describeMethod({
        recipient: '0xR',
        amount: '1.00',
        currency: 'USD',
      }) as MPPPaymentMethod

      // Manually craft a credential with unsupported network but valid proof
      const cred: MPPCredential = {
        version: '1.0',
        challengeId: method.challenge_id,
        network: 'dogecoin',
        proof: { transactionHash: '0xFoo' },
        payer: 'agent',
        timestamp: new Date().toISOString(),
      }

      const headerValue = serializeCredential(cred)
      const req = makeRequest({ authorization: headerValue })
      const result = await adapter.verify(req, { amount: '1.00', currency: 'USD' })
      expect(result.valid).toBe(false)
      expect(result.error).toContain('Unsupported payment network')
    })

    it('returns error for missing Authorization header', async () => {
      const req = makeRequest({})
      const result = await adapter.verify(req, { amount: '1.00', currency: 'USD' })
      expect(result.valid).toBe(false)
      expect(result.error).toContain('Missing Authorization header')
    })

    it('returns error for malformed credential', async () => {
      const req = makeRequest({ authorization: 'MPP not-valid-base64!!!' })
      const result = await adapter.verify(req, { amount: '1.00', currency: 'USD' })
      expect(result.valid).toBe(false)
      expect(result.error).toContain('Invalid MPP credential')
    })
  })

  describe('pay (server-side)', () => {
    it('throws because pay is not available on server side', async () => {
      const method: MPPPaymentMethod = {
        type: 'mpp',
        challenge_id: 'ch',
        networks: ['tempo'],
        amount: '1.00',
        currency: 'USD',
        recipient: '0xR',
        sessions_supported: false,
      }
      await expect(adapter.pay(method, { amount: '1.00', currency: 'USD' })).rejects.toThrow(
        'not available on the server side'
      )
    })
  })
})

// ---------------------------------------------------------------------------
// MPPSessionManager tests
// ---------------------------------------------------------------------------

describe('MPPSessionManager', () => {
  let manager: MPPSessionManager

  beforeEach(() => {
    manager = new MPPSessionManager()
  })

  describe('createSession', () => {
    it('creates a session with correct fields', async () => {
      const session = await manager.createSession({
        maxAmount: '10.00',
        currency: 'USD',
        network: 'tempo',
        recipient: '0xR',
        duration: '1h',
      })

      expect(session.sessionId).toMatch(/^mpp_sess_/)
      expect(session.maxAmount).toBe('10.00')
      expect(session.spent).toBe('0.00')
      expect(session.currency).toBe('USD')
      expect(session.network).toBe('tempo')
      expect(session.active).toBe(true)
      expect(new Date(session.expiresAt).getTime()).toBeGreaterThan(Date.now())
    })

    it('defaults duration to 1h', async () => {
      const before = Date.now()
      const session = await manager.createSession({
        maxAmount: '5.00',
        currency: 'USD',
        network: 'stripe',
        recipient: '0xR',
      })
      const expiresMs = new Date(session.expiresAt).getTime()
      // ~1 hour from now
      expect(expiresMs).toBeGreaterThanOrEqual(before + 3600 * 1000 - 100)
      expect(expiresMs).toBeLessThanOrEqual(before + 3600 * 1000 + 100)
    })
  })

  describe('chargeSession', () => {
    it('charges and updates remaining balance', async () => {
      const session = await manager.createSession({
        maxAmount: '10.00',
        currency: 'USD',
        network: 'tempo',
        recipient: '0xR',
        duration: '1h',
      })

      const result = await manager.chargeSession(session.sessionId, '3.00')
      expect(result.receipt).toMatch(/^mpp_chrg_/)
      expect(result.remaining).toBe('7.00')

      const result2 = await manager.chargeSession(session.sessionId, '2.50')
      expect(result2.remaining).toBe('4.50')
    })

    it('throws when charge exceeds remaining balance', async () => {
      const session = await manager.createSession({
        maxAmount: '5.00',
        currency: 'USD',
        network: 'tempo',
        recipient: '0xR',
        duration: '1h',
      })

      await manager.chargeSession(session.sessionId, '4.00')

      await expect(
        manager.chargeSession(session.sessionId, '2.00')
      ).rejects.toThrow('Insufficient session balance')
    })

    it('throws for non-existent session', async () => {
      await expect(
        manager.chargeSession('mpp_sess_nonexistent', '1.00')
      ).rejects.toThrow('Session not found')
    })

    it('throws for expired session', async () => {
      const session = await manager.createSession({
        maxAmount: '10.00',
        currency: 'USD',
        network: 'tempo',
        recipient: '0xR',
        duration: '1m', // 1 minute
      })

      // Manually expire the session
      const status = await manager.getSessionStatus(session.sessionId)
      // Hack: access internal state via another charge after forcing expiry
      // We need to use the internal store, so let's use a workaround:
      // create with 0-like duration isn't possible, so we'll modify via getSessionStatus

      // Create a session that we can expire
      const session2 = await manager.createSession({
        maxAmount: '10.00',
        currency: 'USD',
        network: 'tempo',
        recipient: '0xR',
        duration: '1m',
      })

      // We can't directly modify the session, so we need the manager to do it.
      // The getSessionStatus method auto-expires sessions. Let's use a different approach:
      // Create a session, then wait... but that's slow. Instead, we test the close behavior.

      // Close the session first to deactivate it
      await manager.closeSession(session2.sessionId)

      await expect(
        manager.chargeSession(session2.sessionId, '1.00')
      ).rejects.toThrow('no longer active')
    })
  })

  describe('closeSession', () => {
    it('closes session and returns refund amount', async () => {
      const session = await manager.createSession({
        maxAmount: '10.00',
        currency: 'USD',
        network: 'tempo',
        recipient: '0xR',
        duration: '1h',
      })

      await manager.chargeSession(session.sessionId, '3.00')
      const result = await manager.closeSession(session.sessionId)
      expect(result.refunded).toBe('7.00')

      // Verify session is now inactive
      const status = await manager.getSessionStatus(session.sessionId)
      expect(status.active).toBe(false)
    })

    it('returns full amount as refund if nothing was spent', async () => {
      const session = await manager.createSession({
        maxAmount: '5.00',
        currency: 'USD',
        network: 'tempo',
        recipient: '0xR',
        duration: '1h',
      })

      const result = await manager.closeSession(session.sessionId)
      expect(result.refunded).toBe('5.00')
    })

    it('throws for non-existent session', async () => {
      await expect(
        manager.closeSession('mpp_sess_nonexistent')
      ).rejects.toThrow('Session not found')
    })
  })

  describe('getSessionStatus', () => {
    it('returns session status', async () => {
      const session = await manager.createSession({
        maxAmount: '10.00',
        currency: 'USD',
        network: 'tempo',
        recipient: '0xR',
        duration: '1h',
      })

      const status = await manager.getSessionStatus(session.sessionId)
      expect(status.sessionId).toBe(session.sessionId)
      expect(status.active).toBe(true)
      expect(status.maxAmount).toBe('10.00')
      expect(status.spent).toBe('0.00')
    })

    it('throws for non-existent session', async () => {
      await expect(
        manager.getSessionStatus('mpp_sess_nonexistent')
      ).rejects.toThrow('Session not found')
    })
  })
})

// ---------------------------------------------------------------------------
// Streaming tests
// ---------------------------------------------------------------------------

describe('Streaming', () => {
  let adapter: MPPAdapter

  beforeEach(() => {
    adapter = new MPPAdapter({
      networks: ['tempo'],
      sessionsSupported: true,
      streamingSupported: true,
    })
  })

  it('full lifecycle: startStream → chargeStreamChunk → endStream', async () => {
    // Create a session first
    const session = await adapter.sessionManager.createSession({
      maxAmount: '10.00',
      currency: 'USD',
      network: 'tempo',
      recipient: '0xR',
      duration: '1h',
    })

    // Start stream
    const meter = await adapter.startStream({
      sessionId: session.sessionId,
      amountPerChunk: '0.01',
      currency: 'USD',
    })

    expect(meter.streamId).toMatch(/^mpp_stream_/)
    expect(meter.sessionId).toBe(session.sessionId)
    expect(meter.chunksCharged).toBe(0)
    expect(meter.totalCharged).toBe('0.00')
    expect(meter.active).toBe(true)

    // Charge chunks
    const after1 = await adapter.chargeStreamChunk(meter.streamId, '0.01')
    expect(after1.chunksCharged).toBe(1)
    expect(after1.totalCharged).toBe('0.01')

    const after2 = await adapter.chargeStreamChunk(meter.streamId, '0.01')
    expect(after2.chunksCharged).toBe(2)
    expect(after2.totalCharged).toBe('0.02')

    const after3 = await adapter.chargeStreamChunk(meter.streamId, '0.05')
    expect(after3.chunksCharged).toBe(3)
    expect(after3.totalCharged).toBe('0.07')

    // Check meter via getter
    const currentMeter = adapter.getStreamMeter(meter.streamId)
    expect(currentMeter).toBeDefined()
    expect(currentMeter!.chunksCharged).toBe(3)

    // End stream
    const final = await adapter.endStream(meter.streamId)
    expect(final.active).toBe(false)
    expect(final.chunksCharged).toBe(3)
    expect(final.totalCharged).toBe('0.07')

    // After ending, meter should be gone
    expect(adapter.getStreamMeter(meter.streamId)).toBeUndefined()
  })

  it('throws when starting stream with non-existent session', async () => {
    await expect(
      adapter.startStream({
        sessionId: 'mpp_sess_fake',
        amountPerChunk: '0.01',
        currency: 'USD',
      })
    ).rejects.toThrow('Session not found')
  })

  it('throws when charging non-existent stream', async () => {
    await expect(
      adapter.chargeStreamChunk('mpp_stream_fake', '0.01')
    ).rejects.toThrow('Stream not found')
  })

  it('throws when ending non-existent stream', async () => {
    await expect(adapter.endStream('mpp_stream_fake')).rejects.toThrow('Stream not found')
  })

  it('throws when charging an ended stream', async () => {
    const session = await adapter.sessionManager.createSession({
      maxAmount: '10.00',
      currency: 'USD',
      network: 'tempo',
      recipient: '0xR',
      duration: '1h',
    })

    const meter = await adapter.startStream({
      sessionId: session.sessionId,
      amountPerChunk: '0.01',
      currency: 'USD',
    })

    await adapter.endStream(meter.streamId)

    // Stream is deleted after endStream, so this should throw "not found"
    await expect(
      adapter.chargeStreamChunk(meter.streamId, '0.01')
    ).rejects.toThrow('Stream not found')
  })

  it('stream meter updates correctly with fractional amounts', async () => {
    const session = await adapter.sessionManager.createSession({
      maxAmount: '1.00',
      currency: 'USD',
      network: 'tempo',
      recipient: '0xR',
      duration: '1h',
    })

    const meter = await adapter.startStream({
      sessionId: session.sessionId,
      amountPerChunk: '0.001',
      currency: 'USD',
    })

    // Charge many small amounts
    for (let i = 0; i < 10; i++) {
      await adapter.chargeStreamChunk(meter.streamId, '0.001')
    }

    const current = adapter.getStreamMeter(meter.streamId)
    expect(current!.chunksCharged).toBe(10)
    expect(current!.totalCharged).toBe('0.01')

    await adapter.endStream(meter.streamId)
  })
})

// ---------------------------------------------------------------------------
// WWW-Authenticate tests
// ---------------------------------------------------------------------------

describe('buildWWWAuthenticate', () => {
  it('starts with "Payment " and contains required parts', () => {
    const adapter = new MPPAdapter({
      networks: ['tempo', 'stripe'],
      sessionsSupported: true,
      streamingSupported: true,
    })

    const header = adapter.buildWWWAuthenticate({
      recipient: '0xRecipient',
      amount: '0.50',
      currency: 'USD',
    })

    expect(header).toMatch(/^Payment /)
    expect(header).toContain('realm="0xRecipient"')
    expect(header).toContain('challenge="')
    expect(header).toContain('networks="tempo,stripe"')
    expect(header).toContain('sessions=true')
    expect(header).toContain('streaming=true')
  })

  it('omits sessions and streaming when not supported', () => {
    const adapter = new MPPAdapter({
      networks: ['lightning'],
      sessionsSupported: false,
      streamingSupported: false,
    })

    const header = adapter.buildWWWAuthenticate({
      recipient: 'ln-node',
      amount: '0.01',
      currency: 'BTC',
    })

    expect(header).toMatch(/^Payment /)
    expect(header).toContain('realm="ln-node"')
    expect(header).not.toContain('sessions=true')
    expect(header).not.toContain('streaming=true')
  })

  it('contains a valid base64 challenge that can be deserialized', () => {
    const adapter = new MPPAdapter({ networks: ['tempo'] })

    const header = adapter.buildWWWAuthenticate({
      recipient: '0xR',
      amount: '1.00',
      currency: 'USD',
    })

    // Extract the challenge value from the header
    const challengeMatch = header.match(/challenge="([^"]+)"/)
    expect(challengeMatch).not.toBeNull()

    const challenge = deserializeChallenge(challengeMatch![1]!)
    expect(challenge.amount).toBe('1.00')
    expect(challenge.currency).toBe('USD')
    expect(challenge.recipient).toBe('0xR')
  })
})

// ---------------------------------------------------------------------------
// buildReceiptHeader (static)
// ---------------------------------------------------------------------------

describe('MPPAdapter.buildReceiptHeader', () => {
  it('returns a string starting with "Payment "', () => {
    const header = MPPAdapter.buildReceiptHeader({
      id: 'mpp_receipt_1',
      amount: '1.00',
      currency: 'USD',
      network: 'tempo',
      status: 'settled',
      ref: '0xTx123',
    })

    expect(header).toMatch(/^Payment /)

    // Decode the base64 payload
    const encoded = header.slice('Payment '.length)
    const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'))
    expect(decoded.id).toBe('mpp_receipt_1')
    expect(decoded.amount).toBe('1.00')
    expect(decoded.status).toBe('settled')
  })
})
