import { describe, it, expect } from 'vitest'
import { InMemoryReceiptStore } from '../memory-store.js'
import type { AgentPaymentReceipt } from '@openagentpay/core'

function makeReceipt(id: string, amount: string = '0.01', method: string = 'mpp'): AgentPaymentReceipt {
  return {
    id,
    version: '1.0',
    timestamp: new Date().toISOString(),
    payer: { type: 'agent', identifier: 'agent-1' },
    payee: { identifier: '0xRecipient', endpoint: '/api/data' },
    request: { method: 'GET', url: '/api/data' },
    payment: { amount, currency: 'USDC', method: method as any, status: 'settled' },
    response: { status_code: 200, latency_ms: 50 },
  }
}

describe('InMemoryReceiptStore', () => {
  it('saves and retrieves a receipt', async () => {
    const store = new InMemoryReceiptStore()
    const receipt = makeReceipt('r1')
    await store.save(receipt)
    const retrieved = await store.get('r1')
    expect(retrieved).not.toBeNull()
    expect(retrieved!.id).toBe('r1')
  })

  it('returns null for non-existent receipt', async () => {
    const store = new InMemoryReceiptStore()
    expect(await store.get('nope')).toBeNull()
  })

  it('counts receipts', async () => {
    const store = new InMemoryReceiptStore()
    await store.save(makeReceipt('r1'))
    await store.save(makeReceipt('r2'))
    await store.save(makeReceipt('r3'))
    expect(await store.count()).toBe(3)
  })

  it('overwrites on duplicate save (idempotent)', async () => {
    const store = new InMemoryReceiptStore()
    await store.save(makeReceipt('r1', '0.01'))
    await store.save(makeReceipt('r1', '0.02'))
    const r = await store.get('r1')
    expect(r!.payment.amount).toBe('0.02')
    expect(await store.count()).toBe(1)
  })

  it('queries receipts with pagination', async () => {
    const store = new InMemoryReceiptStore()
    for (let i = 0; i < 10; i++) {
      await store.save(makeReceipt(`r${i}`))
    }
    const result = await store.query({ limit: 3 })
    expect(result.receipts.length).toBe(3)
    expect(result.total).toBe(10)
  })

  it('exports as JSON', async () => {
    const store = new InMemoryReceiptStore()
    await store.save(makeReceipt('r1'))
    const json = await store.export({ format: 'json' })
    const parsed = JSON.parse(json)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBe(1)
    expect(parsed[0].id).toBe('r1')
  })

  it('exports as CSV', async () => {
    const store = new InMemoryReceiptStore()
    await store.save(makeReceipt('r1', '0.50', 'x402'))
    const csv = await store.export({ format: 'csv' })
    expect(csv).toContain('r1')
    expect(csv).toContain('0.50')
  })

  it('computes summary', async () => {
    const store = new InMemoryReceiptStore()
    await store.save(makeReceipt('r1', '1.00', 'mpp'))
    await store.save(makeReceipt('r2', '2.00', 'mpp'))
    await store.save(makeReceipt('r3', '3.00', 'x402'))
    const summary = await store.summary()
    expect(summary.totalCount).toBe(3)
  })
})
