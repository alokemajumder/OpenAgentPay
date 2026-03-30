import { describe, it, expect } from 'vitest'
import { DEFAULT_INVOICE_EXPIRY, SATS_PER_BTC, LIGHTNING_PAYMENT_HEADER, LND_ADD_INVOICE_PATH } from '../constants.js'
import { LightningAdapter } from '../lightning-adapter.js'

describe('Lightning Constants', () => {
  it('default invoice expiry is 600 seconds', () => {
    expect(DEFAULT_INVOICE_EXPIRY).toBe(600)
  })

  it('sats per BTC is 100 million', () => {
    expect(SATS_PER_BTC).toBe(100_000_000)
  })

  it('header name is correct', () => {
    expect(LIGHTNING_PAYMENT_HEADER).toBe('x-lightning-payment')
  })

  it('LND API paths are correct', () => {
    expect(LND_ADD_INVOICE_PATH).toBe('/v1/invoices')
  })
})

describe('LightningAdapter', () => {
  const adapter = new LightningAdapter({
    nodeUrl: 'https://localhost:8080',
    macaroon: 'deadbeef',
  })

  it('detects X-LIGHTNING-PAYMENT header', () => {
    // Adapter decodes base64 JSON proof and checks for .preimage
    const proof = Buffer.from(JSON.stringify({ preimage: 'abc123', rHash: 'def', amountSats: 100 })).toString('base64')
    expect(adapter.detect({ headers: { 'x-lightning-payment': proof }, method: 'GET', url: '/' })).toBe(true)
  })

  it('does not detect missing header', () => {
    expect(adapter.detect({ headers: {}, method: 'GET', url: '/' })).toBe(false)
  })

  it('does not detect empty header', () => {
    expect(adapter.detect({ headers: { 'x-lightning-payment': '' }, method: 'GET', url: '/' })).toBe(false)
  })

  it('supports lightning method type', () => {
    expect(adapter.supports({ type: 'lightning' } as any)).toBe(true)
    expect(adapter.supports({ type: 'mpp' } as any)).toBe(false)
  })

  it('pay() throws on server side', async () => {
    await expect(adapter.pay({} as any, {} as any)).rejects.toThrow()
  })
})
