/**
 * @module solana-adapter
 *
 * Server-side Solana SPL token payment adapter for OpenAgentPay.
 *
 * The SolanaAdapter handles the API provider side of Solana payments:
 * 1. Detects X-SOLANA-PAYMENT headers containing payment proofs
 * 2. Deserializes the proof and extracts the transaction signature
 * 3. Verifies the transaction via Solana RPC (getTransaction)
 * 4. Validates amount, recipient, and token mint
 * 5. Returns verification results with receipt data
 *
 * @example
 * ```ts
 * import { solana } from '@openagentpay/adapter-solana'
 *
 * const adapter = solana({
 *   rpcUrl: 'https://api.mainnet-beta.solana.com',
 *   supportedTokens: ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'],
 * })
 * ```
 */

import type {
  PaymentAdapter,
  VerifyResult,
  PaymentProof,
  Pricing,
  PaymentMethod,
  AdapterConfig,
  IncomingRequest,
  SolanaPaymentMethod,
  AgentPaymentReceipt,
} from '@openagentpay/core'

import {
  InsufficientAmountError,
} from '@openagentpay/core'

import {
  USDC_MINT,
  DEFAULT_RPC_URL,
  TOKEN_DECIMALS,
  KNOWN_TOKENS,
  RPC_HTTP_TIMEOUT_MS,
  SOLANA_PAYMENT_HEADER,
} from './constants.js'
import type { SolanaAdapterConfig, SolanaPaymentProof } from './types.js'

// ---------------------------------------------------------------------------
// SolanaAdapter
// ---------------------------------------------------------------------------

/**
 * Server-side Solana SPL token payment adapter.
 *
 * Implements the full {@link PaymentAdapter} interface for Solana
 * SPL token payments. Handles detection, verification, and RPC-based
 * transaction confirmation for SPL token transfers.
 *
 * The `pay` method throws on the server-side adapter — use {@link SolanaWallet}
 * for client-side payment execution.
 */
export class SolanaAdapter implements PaymentAdapter {
  readonly type = 'solana' as const

  private readonly rpcUrl: string
  private readonly supportedTokens: Set<string>
  private readonly confirmationLevel: 'confirmed' | 'finalized'

  constructor(config: SolanaAdapterConfig = {}) {
    this.rpcUrl = config.rpcUrl ?? DEFAULT_RPC_URL
    this.supportedTokens = new Set(
      config.supportedTokens ?? [USDC_MINT['mainnet-beta']]
    )
    this.confirmationLevel = config.confirmationLevel ?? 'confirmed'
  }

  /**
   * Detect whether the incoming request carries a Solana payment.
   *
   * Checks for the X-SOLANA-PAYMENT header containing a base64-encoded
   * JSON payload with a transaction signature.
   *
   * @param req - The incoming HTTP request
   * @returns `true` if the request contains a valid Solana payment header
   */
  detect(req: IncomingRequest): boolean {
    const header = this.getHeader(req, SOLANA_PAYMENT_HEADER)
    if (!header) return false

    try {
      const proof = this.decodeProof(header)
      return typeof proof.signature === 'string' && proof.signature.length > 0
    } catch {
      return false
    }
  }

  /**
   * Verify a Solana SPL token payment via RPC.
   *
   * Verification steps:
   * 1. Decode the X-SOLANA-PAYMENT header from base64 JSON
   * 2. Check that the token mint is supported
   * 3. Fetch the transaction via getTransaction RPC call
   * 4. Validate the transaction is confirmed at the required level
   * 5. Parse the SPL token transfer instruction from the transaction
   * 6. Verify amount, recipient, and token mint match expectations
   *
   * @param req     - The incoming HTTP request with X-SOLANA-PAYMENT header
   * @param pricing - The pricing requirements for this endpoint
   * @returns Verification result with receipt data on success
   */
  async verify(req: IncomingRequest, pricing: Pricing): Promise<VerifyResult> {
    const header = this.getHeader(req, SOLANA_PAYMENT_HEADER)
    if (!header) {
      return { valid: false, error: 'Missing X-SOLANA-PAYMENT header' }
    }

    // Step 1: Decode proof
    let proof: SolanaPaymentProof
    try {
      proof = this.decodeProof(header)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { valid: false, error: `Invalid payment proof: ${message}` }
    }

    // Step 2: Check token is supported
    if (!this.supportedTokens.has(proof.tokenMint)) {
      return {
        valid: false,
        error: `Unsupported token mint: ${proof.tokenMint}`,
      }
    }

    // Step 3: Fetch transaction via RPC
    let txData: SolanaTransactionResponse
    try {
      txData = await this.getTransaction(proof.signature)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { valid: false, error: `Failed to fetch transaction: ${message}` }
    }

    // Step 4: Validate confirmation
    if (!txData) {
      return { valid: false, error: 'Transaction not found on chain' }
    }

    if (txData.meta?.err) {
      return { valid: false, error: 'Transaction failed on chain' }
    }

    // Step 5: Parse the SPL token transfer from transaction metadata
    const transfer = this.extractTokenTransfer(txData, proof.tokenMint)
    if (!transfer) {
      return {
        valid: false,
        error: 'No matching SPL token transfer found in transaction',
      }
    }

    // Step 6: Validate amount
    const decimals = TOKEN_DECIMALS[proof.tokenMint] ?? 6
    const requiredSmallestUnit = this.toSmallestUnit(pricing.amount, decimals)

    if (BigInt(transfer.amount) < requiredSmallestUnit) {
      return {
        valid: false,
        error: new InsufficientAmountError(
          `Payment amount ${transfer.amount} is less than required ${requiredSmallestUnit.toString()}`
        ).message,
      }
    }

    // Build receipt
    const path = req.url ?? '/unknown'
    const method = req.method ?? 'GET'
    const now = new Date().toISOString()

    const receipt: Partial<AgentPaymentReceipt> = {
      version: '1.0',
      timestamp: now,
      payer: {
        type: 'agent',
        identifier: transfer.source,
      },
      payee: {
        identifier: transfer.destination,
        endpoint: path,
      },
      request: {
        method,
        url: path,
      },
      payment: {
        amount: pricing.amount,
        currency: pricing.currency,
        method: 'solana',
        transaction_hash: proof.signature,
        network: 'solana',
        status: 'settled',
      },
    }

    return {
      valid: true,
      receipt,
    }
  }

  /**
   * Generate the Solana payment method descriptor for 402 responses.
   *
   * Returns a {@link SolanaPaymentMethod} that tells agents how to
   * construct an SPL token transfer for payment.
   *
   * @param config - Must include `recipient` (the Solana wallet address).
   *                 May also include `tokenMint` to specify which token.
   * @returns A SolanaPaymentMethod for inclusion in the 402 response
   */
  describeMethod(config: AdapterConfig): PaymentMethod {
    const tokenMint = (config.tokenMint as string) ??
      Array.from(this.supportedTokens)[0]

    const tokenInfo = KNOWN_TOKENS[tokenMint]
    const symbol = tokenInfo?.symbol ?? 'SPL'
    const decimals = tokenInfo?.decimals ?? TOKEN_DECIMALS[tokenMint] ?? 6

    const method: SolanaPaymentMethod = {
      type: 'solana',
      rpc_url: this.rpcUrl,
      token_mint: tokenMint,
      token_symbol: symbol,
      decimals,
      pay_to: config.recipient,
    }

    return method
  }

  /**
   * Check whether this adapter can handle the given payment method.
   *
   * Returns `true` for Solana payment methods with a supported token mint.
   *
   * @param method - The payment method to check
   * @returns `true` if this adapter handles the method
   */
  supports(method: PaymentMethod): boolean {
    if (method.type !== 'solana') return false
    const solanaMethod = method as SolanaPaymentMethod
    return this.supportedTokens.has(solanaMethod.token_mint)
  }

  /**
   * Client-side payment execution — not supported on the server adapter.
   *
   * Use {@link SolanaWallet} for client-side payment. The server adapter
   * only handles detection and verification.
   *
   * @throws {Error} Always throws — use SolanaWallet for client-side payments
   */
  async pay(_method: PaymentMethod, _pricing: Pricing): Promise<PaymentProof> {
    throw new Error(
      'SolanaAdapter.pay() is not supported on the server side. ' +
      'Use SolanaWallet for client-side payment execution.'
    )
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Decode a base64-encoded payment proof from the header value.
   */
  private decodeProof(header: string): SolanaPaymentProof {
    const json = Buffer.from(header, 'base64').toString('utf-8')
    const proof = JSON.parse(json) as SolanaPaymentProof

    if (!proof.signature || typeof proof.signature !== 'string') {
      throw new Error('Proof missing transaction signature')
    }
    if (typeof proof.slot !== 'number') {
      throw new Error('Proof missing slot number')
    }
    if (!proof.tokenMint || typeof proof.tokenMint !== 'string') {
      throw new Error('Proof missing token mint')
    }

    return proof
  }

  /**
   * Fetch a confirmed transaction from the Solana RPC.
   */
  private async getTransaction(signature: string): Promise<SolanaTransactionResponse> {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTransaction',
      params: [
        signature,
        {
          encoding: 'jsonParsed',
          commitment: this.confirmationLevel,
          maxSupportedTransactionVersion: 0,
        },
      ],
    })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), RPC_HTTP_TIMEOUT_MS)

    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`RPC request failed with status ${response.status}`)
      }

      const result = await response.json() as {
        result: SolanaTransactionResponse | null
        error?: { message: string }
      }

      if (result.error) {
        throw new Error(`RPC error: ${result.error.message}`)
      }

      return result.result as SolanaTransactionResponse
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * Extract a matching SPL token transfer from a parsed transaction.
   *
   * Looks through the inner instructions and top-level instructions
   * for a `transferChecked` or `transfer` instruction targeting the
   * expected token mint.
   */
  private extractTokenTransfer(
    tx: SolanaTransactionResponse,
    expectedMint: string,
  ): TokenTransferInfo | null {
    // Check parsed inner instructions from the transaction metadata
    const innerInstructions = tx.meta?.innerInstructions ?? []
    for (const inner of innerInstructions) {
      for (const ix of inner.instructions) {
        const transfer = this.parseTokenInstruction(ix, expectedMint)
        if (transfer) return transfer
      }
    }

    // Check top-level instructions
    const message = tx.transaction?.message
    if (message?.instructions) {
      for (const ix of message.instructions) {
        const transfer = this.parseTokenInstruction(ix, expectedMint)
        if (transfer) return transfer
      }
    }

    return null
  }

  /**
   * Parse a single instruction to see if it is a matching SPL token transfer.
   */
  private parseTokenInstruction(
    ix: ParsedInstruction,
    expectedMint: string,
  ): TokenTransferInfo | null {
    if (!ix.parsed) return null

    const { type: ixType, info } = ix.parsed

    // transferChecked includes mint info directly
    if (ixType === 'transferChecked' && info?.mint === expectedMint) {
      return {
        source: info.authority ?? info.source ?? '',
        destination: info.destination ?? '',
        amount: String(info.tokenAmount?.amount ?? info.amount ?? '0'),
        mint: expectedMint,
      }
    }

    // Plain transfer — we accept it if the program is the token program
    if (ixType === 'transfer' && ix.program === 'spl-token') {
      return {
        source: info.authority ?? info.source ?? '',
        destination: info.destination ?? '',
        amount: String(info.amount ?? '0'),
        mint: expectedMint,
      }
    }

    return null
  }

  /**
   * Convert a decimal amount string to the smallest token unit.
   */
  private toSmallestUnit(amount: string, decimals: number): bigint {
    const parts = amount.split('.')
    const whole = parts[0] ?? '0'
    let fraction = parts[1] ?? ''

    // Pad or truncate fraction to match decimals
    if (fraction.length > decimals) {
      fraction = fraction.slice(0, decimals)
    } else {
      fraction = fraction.padEnd(decimals, '0')
    }

    return BigInt(whole + fraction)
  }

  /**
   * Extract a header value from the request, handling case-insensitive
   * lookup and array-valued headers.
   */
  private getHeader(req: IncomingRequest, name: string): string | undefined {
    const headers = req.headers
    const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()]
    if (Array.isArray(value)) {
      return value[0]
    }
    return value ?? undefined
  }
}

// ---------------------------------------------------------------------------
// Internal RPC response types
// ---------------------------------------------------------------------------

/** Minimal shape of a Solana getTransaction JSON-RPC response (jsonParsed). */
interface SolanaTransactionResponse {
  slot: number
  meta: {
    err: unknown | null
    innerInstructions?: Array<{
      index: number
      instructions: ParsedInstruction[]
    }>
  } | null
  transaction: {
    message: {
      instructions: ParsedInstruction[]
      accountKeys: Array<{ pubkey: string }>
    }
    signatures: string[]
  }
}

interface ParsedInstruction {
  program?: string
  programId?: string
  parsed?: {
    type: string
    info: Record<string, unknown> & {
      authority?: string
      source?: string
      destination?: string
      amount?: string | number
      mint?: string
      tokenAmount?: {
        amount: string
        decimals: number
        uiAmount: number
      }
    }
  }
}

interface TokenTransferInfo {
  source: string
  destination: string
  amount: string
  mint: string
}
