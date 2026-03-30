/**
 * @module lightning-adapter
 *
 * Server-side Lightning Network payment adapter for OpenAgentPay.
 *
 * The LightningAdapter handles the API provider side of Lightning payments:
 * 1. Creates BOLT11 invoices via LND REST API for 402 responses
 * 2. Detects X-LIGHTNING-PAYMENT headers containing payment proofs
 * 3. Verifies preimage->rHash relationship (SHA-256 of preimage === rHash)
 * 4. Confirms invoice settlement via LND REST API
 * 5. Returns verification results with receipt data
 *
 * @example
 * ```ts
 * import { lightning } from '@openagentpay/adapter-lightning'
 *
 * const adapter = lightning({
 *   nodeUrl: 'https://localhost:8080',
 *   macaroon: 'hex-encoded-macaroon...',
 * })
 * ```
 */

import { createHash } from 'node:crypto'

import type {
  PaymentAdapter,
  VerifyResult,
  PaymentProof,
  Pricing,
  PaymentMethod,
  AdapterConfig,
  IncomingRequest,
  AgentPaymentReceipt,
} from '@openagentpay/core'

import type { LightningPaymentMethod } from '@openagentpay/core'

import {
  DEFAULT_INVOICE_EXPIRY,
  SATS_PER_BTC,
  LIGHTNING_PAYMENT_HEADER,
  LND_ADD_INVOICE_PATH,
  LND_LOOKUP_INVOICE_PATH,
  LND_HTTP_TIMEOUT_MS,
} from './constants.js'
import type { LightningAdapterConfig, LightningInvoice, LightningPaymentProof } from './types.js'

// ---------------------------------------------------------------------------
// LightningAdapter
// ---------------------------------------------------------------------------

/**
 * Server-side Lightning Network payment adapter.
 *
 * Implements the full {@link PaymentAdapter} interface for BOLT11
 * Lightning invoices. Handles detection, verification, and invoice
 * creation via LND REST API.
 *
 * The `pay` method throws on the server-side adapter — use
 * {@link LightningWallet} for client-side payment execution.
 */
export class LightningAdapter implements PaymentAdapter {
  readonly type = 'lightning' as const

  private readonly nodeUrl: string
  private readonly macaroon: string
  private readonly tlsCert?: string
  private readonly invoiceExpirySeconds: number
  private readonly minAmountSats?: number
  private readonly maxAmountSats?: number

  /** In-memory store of issued invoices, keyed by rHash (hex). */
  private readonly issuedInvoices = new Map<string, LightningInvoice>()

  constructor(config: LightningAdapterConfig) {
    if (!config.nodeUrl) {
      throw new Error('LightningAdapter requires nodeUrl')
    }
    if (!config.macaroon) {
      throw new Error('LightningAdapter requires macaroon')
    }

    this.nodeUrl = config.nodeUrl.replace(/\/$/, '')
    this.macaroon = config.macaroon
    this.tlsCert = config.tlsCert
    this.invoiceExpirySeconds = config.invoiceExpirySeconds ?? DEFAULT_INVOICE_EXPIRY
    this.minAmountSats = config.minAmountSats
    this.maxAmountSats = config.maxAmountSats
  }

  /**
   * Detect whether the incoming request carries a Lightning payment.
   *
   * Checks for the X-LIGHTNING-PAYMENT header containing a base64-encoded
   * JSON payload with a preimage and rHash.
   *
   * @param req - The incoming HTTP request
   * @returns `true` if the request contains a valid Lightning payment header
   */
  detect(req: IncomingRequest): boolean {
    const header = this.getHeader(req, LIGHTNING_PAYMENT_HEADER)
    if (!header) return false

    try {
      const proof = this.decodeProof(header)
      return typeof proof.preimage === 'string' && proof.preimage.length > 0
    } catch {
      return false
    }
  }

  /**
   * Verify a Lightning payment proof.
   *
   * Verification steps:
   * 1. Decode the X-LIGHTNING-PAYMENT header from base64 JSON
   * 2. Verify the preimage: SHA-256(preimage) must equal rHash
   * 3. Look up the invoice via LND REST API to confirm settlement
   * 4. Validate the amount matches the pricing requirement
   *
   * @param req     - The incoming HTTP request with X-LIGHTNING-PAYMENT header
   * @param pricing - The pricing requirements for this endpoint
   * @returns Verification result with receipt data on success
   */
  async verify(req: IncomingRequest, pricing: Pricing): Promise<VerifyResult> {
    const header = this.getHeader(req, LIGHTNING_PAYMENT_HEADER)
    if (!header) {
      return { valid: false, error: 'Missing X-LIGHTNING-PAYMENT header' }
    }

    // Step 1: Decode proof
    let proof: LightningPaymentProof
    try {
      proof = this.decodeProof(header)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { valid: false, error: `Invalid payment proof: ${message}` }
    }

    // Step 2: Verify preimage -> rHash relationship
    const preimageBytes = new Uint8Array(
      proof.preimage.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
    )
    const computedHash = createHash('sha256')
      .update(preimageBytes)
      .digest('hex')

    if (computedHash !== proof.rHash) {
      return {
        valid: false,
        error: 'Preimage does not match payment hash (SHA-256 verification failed)',
      }
    }

    // Step 3: Look up invoice via LND REST API
    let invoiceData: LndInvoiceResponse
    try {
      invoiceData = await this.lookupInvoice(proof.rHash)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { valid: false, error: `Failed to look up invoice: ${message}` }
    }

    // Step 4: Check invoice is settled
    if (invoiceData.state !== 'SETTLED') {
      return {
        valid: false,
        error: `Invoice is not settled (state: ${invoiceData.state})`,
      }
    }

    // Step 5: Validate amount
    const invoiceAmountSats = Number(invoiceData.value)
    const requiredSats = this.pricingToSats(pricing)

    if (invoiceAmountSats < requiredSats) {
      return {
        valid: false,
        error: `Payment amount ${invoiceAmountSats} sats is less than required ${requiredSats} sats`,
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
        identifier: proof.preimage.slice(0, 16) + '...',
      },
      payee: {
        identifier: this.nodeUrl,
        endpoint: path,
      },
      request: {
        method,
        url: path,
      },
      payment: {
        amount: String(invoiceAmountSats),
        currency: 'BTC-SATS',
        method: 'lightning',
        transaction_hash: proof.rHash,
        network: 'lightning',
        status: 'settled',
      },
    }

    // Remove from issued invoices
    this.issuedInvoices.delete(proof.rHash)

    return {
      valid: true,
      receipt,
    }
  }

  /**
   * Generate a Lightning payment method descriptor for 402 responses.
   *
   * Creates a BOLT11 invoice via the LND REST API and returns a
   * {@link LightningPaymentMethod} that tells agents how to pay.
   *
   * @param config - Must include `recipient` and `amount` (in sats or as pricing).
   *                 May include `memo` for the invoice description.
   * @returns A LightningPaymentMethod for inclusion in the 402 response
   */
  describeMethod(config: AdapterConfig): PaymentMethod {
    // describeMethod is synchronous per the interface, but we need to
    // create an invoice asynchronously. We pre-generate a placeholder
    // that will be populated by the async createInvoiceMethod helper.
    //
    // For the synchronous interface, we return a method with empty
    // payment_request that must be populated via createInvoiceMethod().
    // Callers who need a real invoice should use createInvoiceMethod().
    const amountSats = Number(config.amountSats ?? config.amount ?? 0)

    const method: LightningPaymentMethod = {
      type: 'lightning',
      payment_request: '',
      r_hash: '',
      amount_sats: amountSats,
      expires_at: new Date(Date.now() + this.invoiceExpirySeconds * 1000).toISOString(),
      node_pubkey: config.nodePubkey as string | undefined,
    }

    return method
  }

  /**
   * Create a BOLT11 invoice and return a fully populated LightningPaymentMethod.
   *
   * This is the async counterpart to describeMethod. Since the PaymentAdapter
   * interface requires describeMethod to be synchronous, this method should
   * be called by middleware that needs real invoices.
   *
   * @param amountSats - Amount in satoshis
   * @param memo       - Optional invoice memo/description
   * @returns A LightningPaymentMethod with a real BOLT11 payment request
   */
  async createInvoiceMethod(amountSats: number, memo?: string): Promise<LightningPaymentMethod> {
    // Validate amount bounds
    if (this.minAmountSats !== undefined && amountSats < this.minAmountSats) {
      throw new Error(`Amount ${amountSats} sats is below minimum ${this.minAmountSats} sats`)
    }
    if (this.maxAmountSats !== undefined && amountSats > this.maxAmountSats) {
      throw new Error(`Amount ${amountSats} sats exceeds maximum ${this.maxAmountSats} sats`)
    }

    const invoice = await this.createInvoice(amountSats, memo)

    // Track the issued invoice
    this.issuedInvoices.set(invoice.rHash, invoice)

    return {
      type: 'lightning',
      payment_request: invoice.paymentRequest,
      r_hash: invoice.rHash,
      amount_sats: invoice.amountSats,
      expires_at: invoice.expiresAt,
    }
  }

  /**
   * Check whether this adapter can handle the given payment method.
   *
   * @param method - The payment method to check
   * @returns `true` if this adapter handles Lightning payments
   */
  supports(method: PaymentMethod): boolean {
    return method.type === 'lightning'
  }

  /**
   * Client-side payment execution — not supported on the server adapter.
   *
   * Use {@link LightningWallet} for client-side payment. The server adapter
   * only handles detection, verification, and invoice creation.
   *
   * @throws {Error} Always throws — use LightningWallet for client-side payments
   */
  async pay(_method: PaymentMethod, _pricing: Pricing): Promise<PaymentProof> {
    throw new Error(
      'LightningAdapter.pay() is not supported on the server side. ' +
      'Use LightningWallet for client-side payment execution.'
    )
  }

  /**
   * Get the current set of issued (unpaid) invoices.
   *
   * Useful for monitoring and cleanup of expired invoices.
   */
  getIssuedInvoices(): ReadonlyMap<string, LightningInvoice> {
    return this.issuedInvoices
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Decode a base64-encoded payment proof from the header value.
   */
  private decodeProof(header: string): LightningPaymentProof {
    const json = Buffer.from(header, 'base64').toString('utf-8')
    const proof = JSON.parse(json) as LightningPaymentProof

    if (!proof.preimage || typeof proof.preimage !== 'string') {
      throw new Error('Proof missing preimage')
    }
    if (!proof.rHash || typeof proof.rHash !== 'string') {
      throw new Error('Proof missing rHash')
    }
    if (typeof proof.amountSats !== 'number') {
      throw new Error('Proof missing amountSats')
    }

    return proof
  }

  /**
   * Create an invoice via the LND REST API.
   *
   * POST /v1/invoices
   * Body: { value: string, expiry: string, memo?: string }
   */
  private async createInvoice(amountSats: number, memo?: string): Promise<LightningInvoice> {
    const url = `${this.nodeUrl}${LND_ADD_INVOICE_PATH}`
    const body = JSON.stringify({
      value: String(amountSats),
      expiry: String(this.invoiceExpirySeconds),
      ...(memo ? { memo } : {}),
    })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), LND_HTTP_TIMEOUT_MS)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Grpc-Metadata-macaroon': this.macaroon,
        },
        body,
        signal: controller.signal,
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`LND API returned status ${response.status}: ${text}`)
      }

      const result = await response.json() as LndAddInvoiceResponse

      // LND returns r_hash as base64 — convert to hex
      const rHashHex = Buffer.from(result.r_hash, 'base64').toString('hex')
      const expiresAt = new Date(
        Date.now() + this.invoiceExpirySeconds * 1000
      ).toISOString()

      return {
        paymentRequest: result.payment_request,
        rHash: rHashHex,
        amountSats,
        expiresAt,
        memo,
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * Look up an invoice by payment hash via LND REST API.
   *
   * GET /v1/invoice/{r_hash_str}
   */
  private async lookupInvoice(rHashHex: string): Promise<LndInvoiceResponse> {
    // LND expects the r_hash as a URL-safe base64 string in the path
    const rHashBase64Url = Buffer.from(rHashHex, 'hex')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')

    const url = `${this.nodeUrl}${LND_LOOKUP_INVOICE_PATH}/${rHashBase64Url}`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), LND_HTTP_TIMEOUT_MS)

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Grpc-Metadata-macaroon': this.macaroon,
        },
        signal: controller.signal,
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`LND API returned status ${response.status}: ${text}`)
      }

      return await response.json() as LndInvoiceResponse
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * Convert pricing to satoshis.
   *
   * Supports BTC (converts to sats) and direct satoshi amounts.
   */
  private pricingToSats(pricing: Pricing): number {
    const currency = pricing.currency.toUpperCase()
    const amount = Number(pricing.amount)

    if (currency === 'BTC') {
      return Math.ceil(amount * SATS_PER_BTC)
    }
    if (currency === 'SATS' || currency === 'BTC-SATS' || currency === 'SAT') {
      return Math.ceil(amount)
    }

    // If the currency is something else, treat amount as sats
    return Math.ceil(amount)
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
// LND REST API response types
// ---------------------------------------------------------------------------

/** Response from POST /v1/invoices (addinvoice). */
interface LndAddInvoiceResponse {
  /** Base64-encoded payment hash. */
  r_hash: string
  /** BOLT11 payment request string. */
  payment_request: string
  /** Index of the invoice in the LND database. */
  add_index: string
  /** Base64-encoded payment address (for MPP). */
  payment_addr: string
}

/** Response from GET /v1/invoice/{r_hash} (lookupinvoice). */
interface LndInvoiceResponse {
  /** Invoice memo/description. */
  memo: string
  /** Base64-encoded payment preimage (only present when settled). */
  r_preimage: string
  /** Base64-encoded payment hash. */
  r_hash: string
  /** Invoice amount in satoshis (string). */
  value: string
  /** Invoice amount in milli-satoshis (string). */
  value_msat: string
  /** Whether the invoice has been settled. */
  settled: boolean
  /** Invoice state: OPEN, SETTLED, CANCELED, ACCEPTED. */
  state: 'OPEN' | 'SETTLED' | 'CANCELED' | 'ACCEPTED'
  /** Amount paid in satoshis (may differ from value for overpayments). */
  amt_paid_sat: string
  /** Amount paid in milli-satoshis. */
  amt_paid_msat: string
}
