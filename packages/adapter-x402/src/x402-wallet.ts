/**
 * @module x402-wallet
 *
 * Client-side x402 wallet for OpenAgentPay.
 *
 * The X402Wallet handles the AI agent side of the x402 protocol:
 * 1. Receives payment method details from a 402 response
 * 2. Constructs an EIP-3009 transferWithAuthorization
 * 3. Signs it with the agent's private key
 * 4. Returns the payment proof as an X-PAYMENT header
 *
 * @example
 * ```ts
 * import { x402Wallet } from '@openagentpay/adapter-x402'
 *
 * const wallet = x402Wallet({
 *   privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
 *   network: 'base-sepolia',
 * })
 *
 * // Called automatically by the client SDK after receiving a 402
 * const proof = await wallet.pay(method, pricing)
 * // { header: 'X-PAYMENT', value: 'eyJzY2hlbWUiOi...' }
 * ```
 */

import type {
  PaymentProof,
  Pricing,
  PaymentMethod,
  X402PaymentMethod,
} from '@openagentpay/core'

import {
  buildAuthorization,
  signAuthorization,
  encodePayment,
  deriveAddress,
} from './eip3009.js'
import { DEFAULT_TIMEOUT_SECONDS } from './constants.js'
import type { X402WalletConfig } from './types.js'

// ---------------------------------------------------------------------------
// X402Wallet
// ---------------------------------------------------------------------------

/**
 * Client-side x402 payment wallet.
 *
 * Constructs and signs EIP-3009 transferWithAuthorization messages
 * for USDC payments on Base. The signed authorization is encoded
 * as the X-PAYMENT header value for the retry request.
 *
 * This wallet is designed to be used by AI agents autonomously.
 * Given a 402 response with an x402 payment method, the wallet
 * can construct and sign the payment without human intervention.
 */
export class X402Wallet {
  private readonly privateKey: string
  private readonly network: string
  private readonly address: string

  constructor(config: X402WalletConfig) {
    if (!config.privateKey) {
      throw new Error('X402Wallet requires a privateKey')
    }

    // Normalize private key format
    this.privateKey = config.privateKey.startsWith('0x')
      ? config.privateKey
      : `0x${config.privateKey}`
    this.network = config.network ?? 'base-sepolia'
    this.address = deriveAddress(this.privateKey)
  }

  /**
   * Execute an x402 payment and return the proof header.
   *
   * Steps:
   * 1. Extract the payTo address from the payment method
   * 2. Build an EIP-3009 transferWithAuthorization
   * 3. Sign it with the wallet's private key (EIP-712)
   * 4. Encode the signed payload as base64
   * 5. Return as an X-PAYMENT header
   *
   * @param method  - The x402 payment method from the 402 response
   * @param pricing - The pricing requirements to satisfy
   * @returns Payment proof containing the X-PAYMENT header and value
   */
  async pay(method: PaymentMethod, pricing: Pricing): Promise<PaymentProof> {
    if (method.type !== 'x402') {
      throw new Error(`X402Wallet cannot handle payment method type: ${method.type}`)
    }

    const x402Method = method as X402PaymentMethod
    const timeout = x402Method.max_timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS

    // Build the EIP-3009 authorization
    const authorization = buildAuthorization(
      this.address,
      x402Method.pay_to,
      pricing.amount,
      timeout,
    )

    // Sign the authorization (produces the full X402Payment)
    const payment = signAuthorization(
      this.privateKey,
      x402Method.network,
      authorization,
    )

    // Encode as base64 for the X-PAYMENT header
    const encoded = encodePayment(payment)

    return {
      header: 'X-PAYMENT',
      value: encoded,
    }
  }

  /**
   * Check whether this wallet can handle the given payment method.
   *
   * Returns `true` for x402 methods on the same network as this wallet.
   *
   * @param method - The payment method to check
   * @returns `true` if this wallet can pay using the method
   */
  supports(method: PaymentMethod): boolean {
    if (method.type !== 'x402') return false
    const x402Method = method as X402PaymentMethod
    return x402Method.network === this.network
  }

  /**
   * Get the wallet's Ethereum address.
   *
   * This is the address derived from the private key and will appear
   * as the `from` field in EIP-3009 authorizations.
   *
   * @returns The 0x-prefixed Ethereum address
   */
  getAddress(): string {
    return this.address
  }

  /**
   * Get the network this wallet is configured for.
   *
   * @returns The network identifier (e.g. "base-sepolia", "base")
   */
  getNetwork(): string {
    return this.network
  }
}
