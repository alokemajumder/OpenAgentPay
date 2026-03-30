import { describe, it, expect } from 'vitest'
import { AgentIdentityManager } from '../identity.js'

// Known Ed25519 seed (32 bytes hex)
const TEST_SEED = 'a'.repeat(64)

describe('AgentIdentityManager', () => {
  it('creates a DID from a private key', () => {
    const mgr = new AgentIdentityManager({ privateKey: TEST_SEED, label: 'test' })
    const did = mgr.getDID()
    expect(did.id).toMatch(/^did:key:z6Mk/)
    expect(did.method).toBe('key')
    expect(did.keyType).toBe('Ed25519')
    expect(did.label).toBe('test')
    expect(did.publicKey).toHaveLength(64) // 32 bytes hex
  })

  it('generates deterministic DID from same key', () => {
    const mgr1 = new AgentIdentityManager({ privateKey: TEST_SEED })
    const mgr2 = new AgentIdentityManager({ privateKey: TEST_SEED })
    expect(mgr1.getDID().id).toBe(mgr2.getDID().id)
  })

  it('signs and verifies data', () => {
    const mgr = new AgentIdentityManager({ privateKey: TEST_SEED })
    const did = mgr.getDID()
    const signature = mgr.sign('hello world')
    expect(typeof signature).toBe('string')
    expect(signature.length).toBeGreaterThan(0)

    const valid = mgr.verify('hello world', signature, did.publicKey)
    expect(valid).toBe(true)
  })

  it('verification fails for wrong data', () => {
    const mgr = new AgentIdentityManager({ privateKey: TEST_SEED })
    const did = mgr.getDID()
    const signature = mgr.sign('hello world')
    const valid = mgr.verify('wrong data', signature, did.publicKey)
    expect(valid).toBe(false)
  })

  it('creates and verifies attestation', () => {
    const mgr = new AgentIdentityManager({ privateKey: TEST_SEED })
    const did = mgr.getDID()

    const attestation = mgr.createAttestation(
      did.id,
      'payment-authorization',
      { maxSpend: '100.00' },
      3600 // 1 hour
    )

    expect(attestation.issuer).toBe(did.id)
    expect(attestation.subject).toBe(did.id)
    expect(attestation.type).toBe('payment-authorization')
    expect(attestation.claims.maxSpend).toBe('100.00')
    expect(attestation.signature).toBeTruthy()
    expect(attestation.expiresAt).toBeDefined()

    const valid = mgr.verifyAttestation(attestation)
    expect(valid).toBe(true)
  })

  it('attestation verification fails when expired', () => {
    const mgr = new AgentIdentityManager({ privateKey: TEST_SEED })
    const did = mgr.getDID()

    const attestation = mgr.createAttestation(did.id, 'test', {}, -1) // already expired
    const valid = mgr.verifyAttestation(attestation)
    expect(valid).toBe(false)
  })

  it('builds KYA profile', () => {
    const mgr = new AgentIdentityManager({ privateKey: TEST_SEED })
    const profile = mgr.buildKYAProfile('TestAgent', 'TestCorp', ['payments'], '1000.00')

    expect(profile.did).toMatch(/^did:key:/)
    expect(profile.name).toBe('TestAgent')
    expect(profile.operator).toBe('TestCorp')
    expect(profile.level).toBe('basic')
    expect(profile.capabilities).toContain('payments')
    expect(profile.maxSpendAuthorization).toBe('1000.00')
    expect(profile.attestations.length).toBe(1)
    expect(profile.attestations[0].type).toBe('identity')
  })
})
