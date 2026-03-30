import { describe, it, expect } from 'vitest'
import { USDC_MINT, TOKEN_DECIMALS, KNOWN_TOKENS, TOKEN_PROGRAM_ID, SOLANA_PAYMENT_HEADER } from '../constants.js'
import { SolanaAdapter } from '../solana-adapter.js'

describe('Solana Constants', () => {
  it('has mainnet USDC mint', () => {
    expect(USDC_MINT['mainnet-beta']).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
  })

  it('has devnet USDC mint', () => {
    expect(USDC_MINT['devnet']).toBe('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
  })

  it('USDC has 6 decimals', () => {
    expect(TOKEN_DECIMALS['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v']).toBe(6)
  })

  it('known tokens have correct metadata', () => {
    const usdc = KNOWN_TOKENS['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v']
    expect(usdc.symbol).toBe('USDC')
    expect(usdc.decimals).toBe(6)
  })

  it('has correct Token Program ID', () => {
    expect(TOKEN_PROGRAM_ID).toBe('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
  })

  it('header name is correct', () => {
    expect(SOLANA_PAYMENT_HEADER).toBe('x-solana-payment')
  })
})

describe('SolanaAdapter', () => {
  const adapter = new SolanaAdapter({ rpcUrl: 'https://api.devnet.solana.com' })

  it('detects X-SOLANA-PAYMENT header', () => {
    // Adapter decodes base64 JSON proof and checks for .signature
    const proof = Buffer.from(JSON.stringify({ signature: 'abc123', slot: 1, tokenMint: 'x' })).toString('base64')
    expect(adapter.detect({ headers: { 'x-solana-payment': proof }, method: 'GET', url: '/' })).toBe(true)
  })

  it('does not detect missing header', () => {
    expect(adapter.detect({ headers: {}, method: 'GET', url: '/' })).toBe(false)
  })

  it('does not detect empty header', () => {
    expect(adapter.detect({ headers: { 'x-solana-payment': '' }, method: 'GET', url: '/' })).toBe(false)
  })

  it('supports solana method type with known token', () => {
    // supports() checks both type AND token_mint against supportedTokens
    const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    expect(adapter.supports({ type: 'solana', token_mint: usdcMint } as any)).toBe(true)
    expect(adapter.supports({ type: 'x402' } as any)).toBe(false)
    expect(adapter.supports({ type: 'solana', token_mint: 'unknown_mint' } as any)).toBe(false)
  })

  it('pay() throws on server side', async () => {
    await expect(adapter.pay({} as any, {} as any)).rejects.toThrow()
  })

  it('describeMethod returns solana type', () => {
    const method = adapter.describeMethod({ recipient: 'SolAddress123' })
    expect(method.type).toBe('solana')
  })
})
