/**
 * @module lightning-wallet
 *
 * Client-side Lightning wallet for OpenAgentPay.
 *
 * The LightningWallet handles the AI agent side of Lightning payments:
 * 1. Receives a BOLT11 invoice from the 402 response
 * 2. Pays the invoice via LND REST API (/v1/channels/transactions)
 * 3. Extracts the payment preimage from the response
 * 4. Returns the proof as an X-LIGHTNING-PAYMENT header
 *
 * @example
 * ```ts
 * import { lightningWallet } from '@openagentpay/adapter-lightning'
 *
 * const wallet = lightningWallet({
 *   nodeUrl: 'https://localhost:8080',
 *   macaroon: 'hex-encoded-macaroon...',
 * })
 *
 * const proof = await wallet.pay(method, pricing)
 * // { header: 'X-LIGHTNING-PAYMENT', value: 'eyJwcmVp...' }
 * ```
 */

import { createHash } from 'node:crypto'

import type {
  PaymentProof,
  Pricing,
  PaymentMethod,
} from '@openagentpay/core'

import type { LightningPaymentMethod } from '@openagentpay/core'

import {
  LIGHTNING_PAYMENT_HEADER,
  LND_SEND_PAYMENT_PATH,
  LND_HTTP_TIMEOUT_MS,
} from './constants.js'
import type { LightningWalletConfig, LightningPaymentProof } from './types.js'

// ---------------------------------------------------------------------------
// LightningWallet
// ---------------------------------------------------------------------------

/**
 * Client-side Lightning Network payment wallet.
 *
 * Pays BOLT11 invoices via the LND REST API and returns the
 * payment preimage as proof. Designed for autonomous AI agent
 * micropayments over the Lightning Network.
 */
export class LightningWallet {
  private readonly nodeUrl: string
  private readonly macaroon: string
  private readonly tlsCert?: string
  private readonly maxFeeSats?: number
  private readonly payerIdentifier?: string

  constructor(config: LightningWalletConfig) {
    if (!config.nodeUrl) {
      throw new Error('LightningWallet requires nodeUrl')
    }
    if (!config.macaroon) {
      throw new Error('LightningWallet requires macaroon')
    }

    this.nodeUrl = config.nodeUrl.replace(/\/$/, '')
    this.macaroon = config.macaroon
    this.tlsCert = config.tlsCert
    this.maxFeeSats = config.maxFeeSats
    this.payerIdentifier = config.payerIdentifier
  }

  /**
   * Pay a BOLT11 Lightning invoice and return the proof header.
   *
   * Steps:
   * 1. Extract the payment request from the Lightning payment method
   * 2. Send payment via LND REST API (/v1/channels/transactions)
   * 3. Extract the preimage from the LND response
   * 4. Verify the preimage matches the expected rHash
   * 5. Return the proof as an X-LIGHTNING-PAYMENT header
   *
   * @param method  - The Lightning payment method from the 402 response
   * @param _pricing - The pricing requirements (amount is encoded in the invoice)
   * @returns Payment proof containing the X-LIGHTNING-PAYMENT header and value
   */
  async pay(method: PaymentMethod, _pricing: Pricing): Promise<PaymentProof> {
    if (method.type !== 'lightning') {
      throw new Error(`LightningWallet cannot handle payment method type: ${method.type}`)
    }

    const lightningMethod = method as LightningPaymentMethod

    if (!lightningMethod.payment_request) {
      throw new Error('Lightning payment method missing payment_request (BOLT11 invoice)')
    }

    // Check expiry
    if (lightningMethod.expires_at) {
      const expiresAt = new Date(lightningMethod.expires_at)
      if (expiresAt.getTime() < Date.now()) {
        throw new Error('Lightning invoice has expired')
      }
    }

    // Pay the invoice via LND REST API
    const result = await this.sendPayment(lightningMethod.payment_request)

    // Extract preimage (LND returns it as base64)
    const preimageHex = Buffer.from(result.payment_preimage, 'base64').toString('hex')

    // Verify preimage matches rHash if we have it
    const preimageBytes = new Uint8Array(
      preimageHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
    )

    if (lightningMethod.r_hash) {
      const computedHash = createHash('sha256')
        .update(preimageBytes)
        .digest('hex')

      if (computedHash !== lightningMethod.r_hash) {
        throw new Error(
          'Payment preimage verification failed: computed hash does not match expected rHash'
        )
      }
    }

    // Compute rHash from preimage if not provided
    const rHash = lightningMethod.r_hash || createHash('sha256')
      .update(preimageBytes)
      .digest('hex')

    // Build the proof
    const proof: LightningPaymentProof = {
      preimage: preimageHex,
      rHash,
      amountSats: lightningMethod.amount_sats,
    }

    const encoded = Buffer.from(JSON.stringify(proof)).toString('base64')

    return {
      header: 'X-LIGHTNING-PAYMENT',
      value: encoded,
    }
  }

  /**
   * Check whether this wallet can handle the given payment method.
   *
   * @param method - The payment method to check
   * @returns `true` if this wallet handles Lightning payments
   */
  supports(method: PaymentMethod): boolean {
    return method.type === 'lightning'
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Send a payment for a BOLT11 invoice via LND REST API.
   *
   * POST /v1/channels/transactions
   * Body: { payment_request: string, fee_limit?: { fixed: string } }
   */
  private async sendPayment(paymentRequest: string): Promise<LndSendPaymentResponse> {
    const url = `${this.nodeUrl}${LND_SEND_PAYMENT_PATH}`

    const requestBody: Record<string, unknown> = {
      payment_request: paymentRequest,
    }

    // Apply fee limit if configured
    if (this.maxFeeSats !== undefined) {
      requestBody.fee_limit = {
        fixed: String(this.maxFeeSats),
      }
    }

    const body = JSON.stringify(requestBody)

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

      const result = await response.json() as LndSendPaymentResponse

      if (result.payment_error) {
        throw new Error(`Lightning payment failed: ${result.payment_error}`)
      }

      if (!result.payment_preimage) {
        throw new Error('LND response missing payment_preimage')
      }

      return result
    } finally {
      clearTimeout(timeout)
    }
  }
}

// ---------------------------------------------------------------------------
// LND REST API response types
// ---------------------------------------------------------------------------

/** Response from POST /v1/channels/transactions (sendpayment). */
interface LndSendPaymentResponse {
  /** Base64-encoded payment preimage (proof of payment). */
  payment_preimage: string
  /** Base64-encoded payment hash. */
  payment_hash: string
  /** Error message if payment failed. */
  payment_error: string
  /** Payment route taken. */
  payment_route: {
    /** Total time lock across the route. */
    total_time_lock: number
    /** Total fees in satoshis. */
    total_fees: string
    /** Total amount sent in satoshis. */
    total_amt: string
  }
}
