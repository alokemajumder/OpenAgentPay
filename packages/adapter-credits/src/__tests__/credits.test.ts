import { describe, it, expect } from 'vitest'
import { InMemoryCreditStore } from '../credit-store.js'
import { CreditsAdapter } from '../credits-adapter.js'

describe('InMemoryCreditStore', () => {
  it('creates an account with initial balance', async () => {
    const store = new InMemoryCreditStore()
    const account = await store.createAccount('acct_1', '100.00', 'USDC')
    expect(account.id).toBe('acct_1')
    expect(account.balance).toBe('100.00')
    expect(account.currency).toBe('USDC')
  })

  it('retrieves an existing account', async () => {
    const store = new InMemoryCreditStore()
    await store.createAccount('acct_1', '50.00', 'USDC')
    const account = await store.getAccount('acct_1')
    expect(account).not.toBeNull()
    expect(account!.balance).toBe('50.00')
  })

  it('returns null for non-existent account', async () => {
    const store = new InMemoryCreditStore()
    const account = await store.getAccount('nope')
    expect(account).toBeNull()
  })

  it('rejects duplicate account creation', async () => {
    const store = new InMemoryCreditStore()
    await store.createAccount('acct_1', '100.00', 'USDC')
    await expect(store.createAccount('acct_1', '50.00', 'USDC')).rejects.toThrow('already exists')
  })

  it('deducts from balance correctly', async () => {
    const store = new InMemoryCreditStore()
    await store.createAccount('acct_1', '100.00', 'USDC')
    const result = await store.deduct('acct_1', '0.50', 'USDC')
    expect(result.success).toBe(true)
    expect(result.newBalance).toBe('99.50')
  })

  it('rejects deduction exceeding balance', async () => {
    const store = new InMemoryCreditStore()
    await store.createAccount('acct_1', '1.00', 'USDC')
    const result = await store.deduct('acct_1', '5.00', 'USDC')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Insufficient')
  })

  it('rejects deduction with wrong currency', async () => {
    const store = new InMemoryCreditStore()
    await store.createAccount('acct_1', '100.00', 'USDC')
    const result = await store.deduct('acct_1', '1.00', 'ETH')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Currency mismatch')
  })

  it('rejects deduction on non-existent account', async () => {
    const store = new InMemoryCreditStore()
    const result = await store.deduct('nope', '1.00', 'USDC')
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('top up adds to balance', async () => {
    const store = new InMemoryCreditStore()
    await store.createAccount('acct_1', '10.00', 'USDC')
    const updated = await store.topUp('acct_1', '20.00')
    expect(updated.balance).toBe('30.00')
  })

  it('handles precise decimal arithmetic', async () => {
    const store = new InMemoryCreditStore()
    await store.createAccount('acct_1', '0.30', 'USDC')
    // 0.1 + 0.2 = 0.3 should work without floating point issues
    const r1 = await store.deduct('acct_1', '0.10', 'USDC')
    expect(r1.success).toBe(true)
    const r2 = await store.deduct('acct_1', '0.10', 'USDC')
    expect(r2.success).toBe(true)
    const r3 = await store.deduct('acct_1', '0.10', 'USDC')
    expect(r3.success).toBe(true)
    expect(r3.newBalance).toBe('0.00')
  })

  it('handles many small deductions', async () => {
    const store = new InMemoryCreditStore()
    await store.createAccount('acct_1', '1.00', 'USDC')
    for (let i = 0; i < 100; i++) {
      const r = await store.deduct('acct_1', '0.01', 'USDC')
      expect(r.success).toBe(true)
    }
    const final = await store.getAccount('acct_1')
    expect(final!.balance).toBe('0.00')
  })
})

describe('CreditsAdapter', () => {
  it('detects X-CREDITS header', () => {
    const store = new InMemoryCreditStore()
    const adapter = new CreditsAdapter({ store })
    expect(adapter.detect({ headers: { 'x-credits': 'acct_1:acct_1' }, method: 'GET', url: '/' })).toBe(true)
  })

  it('does not detect missing header', () => {
    const store = new InMemoryCreditStore()
    const adapter = new CreditsAdapter({ store })
    expect(adapter.detect({ headers: {}, method: 'GET', url: '/' })).toBe(false)
  })

  it('does not detect header without colon', () => {
    const store = new InMemoryCreditStore()
    const adapter = new CreditsAdapter({ store })
    expect(adapter.detect({ headers: { 'x-credits': 'acct_1' }, method: 'GET', url: '/' })).toBe(false)
  })

  it('verifies valid credit payment', async () => {
    const store = new InMemoryCreditStore()
    await store.createAccount('acct_1', '100.00', 'USDC')
    const adapter = new CreditsAdapter({ store })
    const result = await adapter.verify(
      { headers: { 'x-credits': 'acct_1:acct_1' }, method: 'GET', url: '/api/data' },
      { amount: '0.50', currency: 'USDC' }
    )
    expect(result.valid).toBe(true)
    expect(result.receipt).toBeDefined()
    expect(result.receipt!.payment!.amount).toBe('0.50')
  })

  it('rejects invalid signature', async () => {
    const store = new InMemoryCreditStore()
    await store.createAccount('acct_1', '100.00', 'USDC')
    const adapter = new CreditsAdapter({ store })
    const result = await adapter.verify(
      { headers: { 'x-credits': 'acct_1:wrong_sig' }, method: 'GET', url: '/' },
      { amount: '0.50', currency: 'USDC' }
    )
    expect(result.valid).toBe(false)
  })

  it('supports credits method type', () => {
    const store = new InMemoryCreditStore()
    const adapter = new CreditsAdapter({ store })
    expect(adapter.supports({ type: 'credits', purchase_url: '', balance_url: '' })).toBe(true)
    expect(adapter.supports({ type: 'x402' } as any)).toBe(false)
  })

  it('pay() throws on server side', async () => {
    const store = new InMemoryCreditStore()
    const adapter = new CreditsAdapter({ store })
    await expect(adapter.pay({ type: 'credits', purchase_url: '', balance_url: '' }, { amount: '1', currency: 'USDC' })).rejects.toThrow()
  })
})
