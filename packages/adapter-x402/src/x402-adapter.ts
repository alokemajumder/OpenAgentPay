/**
 * @module x402-adapter
 *
 * Server-side x402 payment adapter for OpenAgentPay.
 *
 * The X402Adapter handles the API provider side of the x402 protocol:
 * 1. Detects X-PAYMENT headers containing EIP-3009 authorizations
 * 2. Validates payment amounts against endpoint pricing
 * 3. Checks nonces for replay protection
 * 4. Forwards payments to the facilitator for on-chain settlement
 * 5. Returns verification results with transaction receipts
 *
 * @example
 * ```ts
 * import { x402 } from '@openagentpay/adapter-x402'
 *
 * const adapter = x402({
 *   network: 'base-sepolia',
 *   facilitatorUrl: 'https://x402.org/facilitator',
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
  X402PaymentMethod,
  AgentPaymentReceipt,
} from '@openagentpay/core'

import {
  InsufficientAmountError,
  PaymentReplayError,
} from '@openagentpay/core'

import {
  USDC_ADDRESSES,
  DEFAULT_FACILITATOR_URL,
  DEFAULT_TIMEOUT_SECONDS,
  FACILITATOR_HTTP_TIMEOUT_MS,
} from './constants.js'
import { decodePayment, toUSDCSmallestUnit } from './eip3009.js'
import { verifyWithFacilitator } from './facilitator.js'
import { InMemoryNonceStore } from './nonce-store.js'
import type { X402AdapterConfig, NonceStore, X402Payment } from './types.js'

// ---------------------------------------------------------------------------
// X402Adapter
// ---------------------------------------------------------------------------

/**
 * Server-side x402 payment adapter.
 *
 * Implements the full {@link PaymentAdapter} interface for x402 stablecoin
 * payments. Handles detection, verification, and facilitator interaction
 * for EIP-3009 transferWithAuthorization payments.
 *
 * The `pay` method throws on the server-side adapter — use {@link X402Wallet}
 * for client-side payment execution.
 */
export class X402Adapter implements PaymentAdapter {
  readonly type = 'x402' as const

  private readonly network: string
  private readonly facilitatorUrl: string
  private readonly nonceStore: NonceStore
  private readonly timeoutSeconds: number

  constructor(config: X402AdapterConfig = {}) {
    this.network = config.network ?? 'base-sepolia'
    this.facilitatorUrl = config.facilitatorUrl ?? DEFAULT_FACILITATOR_URL
    this.nonceStore = config.nonceStore ?? new InMemoryNonceStore()
    this.timeoutSeconds = config.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS
  }

  /**
   * Detect whether the incoming request carries an x402 payment.
   *
   * Checks for the X-PAYMENT header containing a base64-encoded JSON
   * payload with `"scheme": "exact"`, which identifies it as an x402
   * EIP-3009 authorization.
   *
   * @param req - The incoming HTTP request
   * @returns `true` if the request contains a valid x402 payment header
   */
  detect(req: IncomingRequest): boolean {
    const header = this.getHeader(req, 'x-payment')
    if (!header) return false

    try {
      const payment = decodePayment(header)
      return payment.scheme === 'exact'
    } catch {
      return false
    }
  }

  /**
   * Verify an x402 payment and forward to the facilitator for settlement.
   *
   * Verification steps:
   * 1. Decode the X-PAYMENT header from base64 JSON
   * 2. Validate the payment amount meets the pricing requirement
   * 3. Check the nonce has not been used (replay protection)
   * 4. Forward to the facilitator for signature verification and settlement
   * 5. If successful, mark the nonce as used and return the receipt
   *
   * @param req     - The incoming HTTP request with X-PAYMENT header
   * @param pricing - The pricing requirements for this endpoint
   * @returns Verification result with receipt data on success
   */
  async verify(req: IncomingRequest, pricing: Pricing): Promise<VerifyResult> {
    const header = this.getHeader(req, 'x-payment')
    if (!header) {
      return { valid: false, error: 'Missing X-PAYMENT header' }
    }

    // Step 1: Decode payment
    let payment: X402Payment
    try {
      payment = decodePayment(header)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { valid: false, error: `Invalid payment: ${message}` }
    }

    // Step 2: Validate amount
    const requiredAmount = toUSDCSmallestUnit(pricing.amount)
    const paidAmount = BigInt(payment.authorization.value)
    const required = BigInt(requiredAmount)

    if (paidAmount < required) {
      return {
        valid: false,
        error: new InsufficientAmountError(
          `Payment amount ${payment.authorization.value} is less than required ${requiredAmount}`
        ).message,
      }
    }

    // Step 3: Check nonce for replay
    const nonce = payment.authorization.nonce
    if (await this.nonceStore.hasBeenUsed(nonce)) {
      return {
        valid: false,
        error: new PaymentReplayError().message,
      }
    }

    // Step 4: Forward to facilitator
    let facilitatorResult
    try {
      facilitatorResult = await verifyWithFacilitator(
        this.facilitatorUrl,
        payment,
        pricing,
        FACILITATOR_HTTP_TIMEOUT_MS,
      )
    } catch (err) {
      // Re-throw FacilitatorUnavailableError — let the middleware handle it
      throw err
    }

    if (!facilitatorResult.success) {
      return {
        valid: false,
        error: facilitatorResult.error ?? 'Facilitator rejected the payment',
      }
    }

    // Step 5: Mark nonce as used and build receipt
    await this.nonceStore.markAsUsed(nonce)

    const path = req.url ?? '/unknown'
    const method = req.method ?? 'GET'
    const now = new Date().toISOString()

    const receipt: Partial<AgentPaymentReceipt> = {
      version: '1.0',
      timestamp: now,
      payer: {
        type: 'agent',
        identifier: payment.authorization.from,
      },
      payee: {
        identifier: payment.authorization.to,
        endpoint: path,
      },
      request: {
        method,
        url: path,
      },
      payment: {
        amount: pricing.amount,
        currency: pricing.currency,
        method: 'x402',
        transaction_hash: facilitatorResult.transaction_hash,
        network: payment.network,
        status: 'settled',
      },
    }

    return {
      valid: true,
      receipt,
    }
  }

  /**
   * Generate the x402 payment method descriptor for 402 responses.
   *
   * Returns an {@link X402PaymentMethod} that tells agents how to
   * construct an EIP-3009 authorization for payment.
   *
   * @param config - Must include `recipient` (the payTo address)
   * @returns An X402PaymentMethod for inclusion in the 402 response
   */
  describeMethod(config: AdapterConfig): PaymentMethod {
    const usdcAddress = USDC_ADDRESSES[this.network]
    if (!usdcAddress) {
      throw new Error(`No USDC address configured for network: ${this.network}`)
    }

    const method: X402PaymentMethod = {
      type: 'x402',
      network: this.network,
      asset: 'USDC',
      asset_address: usdcAddress,
      pay_to: config.recipient,
      facilitator_url: this.facilitatorUrl,
      max_timeout_seconds: this.timeoutSeconds,
    }

    return method
  }

  /**
   * Check whether this adapter can handle the given payment method.
   *
   * Returns `true` for x402 payment methods on the same network.
   *
   * @param method - The payment method to check
   * @returns `true` if this adapter handles the method
   */
  supports(method: PaymentMethod): boolean {
    return method.type === 'x402' && (method as X402PaymentMethod).network === this.network
  }

  /**
   * Client-side payment execution — not supported on the server adapter.
   *
   * Use {@link X402Wallet} for client-side payment. The server adapter
   * only handles detection and verification.
   *
   * @throws {Error} Always throws — use X402Wallet for client-side payments
   */
  async pay(_method: PaymentMethod, _pricing: Pricing): Promise<PaymentProof> {
    throw new Error(
      'X402Adapter.pay() is not supported on the server side. ' +
      'Use X402Wallet for client-side payment execution.'
    )
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
