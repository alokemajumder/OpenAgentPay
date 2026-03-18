/**
 * @module mpp-wallet
 *
 * Client-side MPP wallet for OpenAgentPay.
 *
 * The MPPWallet handles the agent side of the MPP protocol:
 * 1. Receives a Challenge from the 402 response
 * 2. Executes payment on the selected network (Tempo, Stripe, Lightning)
 * 3. Constructs a Credential with proof of payment
 * 4. Returns a PaymentProof with the Authorization header
 *
 * @example
 * ```typescript
 * import { mppWallet } from '@openagentpay/adapter-mpp'
 *
 * // Tempo wallet — on-chain payments
 * const wallet = mppWallet({
 *   network: 'tempo',
 *   tempoPrivateKey: '0xabc...',
 *   tempoRpcUrl: 'https://rpc.tempo.network',
 *   payerIdentifier: '0xdef...',
 * })
 *
 * // Use with OpenAgentPay client
 * const client = createClient({ adapters: [wallet] })
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
  MPPPaymentMethod,
} from '@openagentpay/core'

import { FacilitatorUnavailableError } from '@openagentpay/core'

import type { MPPWalletConfig, MPPSession, MPPSessionConfig } from './types.js'
import { createCredential, serializeCredential } from './credential.js'

// ---------------------------------------------------------------------------
// MPPWallet
// ---------------------------------------------------------------------------

/**
 * Client-side MPP wallet for making payments.
 *
 * Implements the {@link PaymentAdapter} interface for agents that need
 * to pay for API calls using the MPP protocol. The wallet selects the
 * appropriate payment network and constructs credentials with proof.
 *
 * ## Network Support
 *
 * - **Tempo**: On-chain payments via Tempo network. Requires a private
 *   key and RPC URL.
 * - **Stripe**: Shared Payment Token (SPT) flow. Requires a Stripe
 *   payment method or token.
 * - **Lightning**: BOLT11 invoice payments. Requires a Lightning node
 *   connection.
 *
 * ## Sessions
 *
 * The wallet can create MPP sessions for streaming or high-frequency
 * payment flows via the server's session endpoint.
 */
export class MPPWallet implements PaymentAdapter {
  /** Adapter type identifier. Always `"mpp"`. */
  readonly type = 'mpp' as const

  private readonly network: 'tempo' | 'stripe' | 'lightning'
  private readonly tempoPrivateKey?: string
  private readonly tempoRpcUrl?: string
  private readonly stripePaymentMethod?: string
  private readonly stripePublishableKey?: string
  private readonly lightningNodeUrl?: string
  private readonly lightningMacaroon?: string
  private readonly payerIdentifier: string

  /**
   * Creates a new MPPWallet.
   *
   * @param config - Wallet configuration including network and credentials
   */
  constructor(config: MPPWalletConfig) {
    this.network = config.network
    this.tempoPrivateKey = config.tempoPrivateKey
    this.tempoRpcUrl = config.tempoRpcUrl
    this.stripePaymentMethod = config.stripePaymentMethod
    this.stripePublishableKey = config.stripePublishableKey
    this.lightningNodeUrl = config.lightningNodeUrl
    this.lightningMacaroon = config.lightningMacaroon
    this.payerIdentifier = config.payerIdentifier ?? 'mpp-agent'
  }

  /**
   * Not applicable on the client side.
   *
   * The wallet does not detect incoming payments — that is the server's job.
   *
   * @param _req - The incoming request (unused)
   * @returns Always `false`
   */
  detect(_req: IncomingRequest): boolean {
    return false
  }

  /**
   * Not applicable on the client side.
   *
   * The wallet does not verify payments — that is the server's job.
   *
   * @throws {Error} Always — use MPPAdapter for server-side verification
   */
  async verify(_req: IncomingRequest, _pricing: Pricing): Promise<VerifyResult> {
    throw new Error(
      'MPPWallet.verify() is not available on the client side. ' +
      'Use MPPAdapter for server-side payment verification.'
    )
  }

  /**
   * Not applicable on the client side.
   *
   * @throws {Error} Always — use MPPAdapter for describing payment methods
   */
  describeMethod(_config: AdapterConfig): PaymentMethod {
    throw new Error(
      'MPPWallet.describeMethod() is not available on the client side. ' +
      'Use MPPAdapter for server-side payment method description.'
    )
  }

  /**
   * Checks whether this wallet can handle the given payment method.
   *
   * Returns `true` for MPP payment methods that include the wallet's
   * configured network in their accepted networks list.
   *
   * @param method - The payment method to check
   * @returns `true` if this wallet can pay using the method
   */
  supports(method: PaymentMethod): boolean {
    if (method.type !== 'mpp') return false
    const mppMethod = method as MPPPaymentMethod
    return mppMethod.networks.includes(this.network)
  }

  /**
   * Execute a payment and return the proof as an Authorization header.
   *
   * Flow:
   * 1. Parse the MPPPaymentMethod from the 402 response
   * 2. Execute payment on the configured network
   * 3. Construct an MPP Credential with proof of payment
   * 4. Return as a PaymentProof with the Authorization header
   *
   * @param method - The MPP payment method from the 402 response
   * @param pricing - The pricing requirements
   * @returns PaymentProof with Authorization header containing the credential
   */
  async pay(method: PaymentMethod, pricing: Pricing): Promise<PaymentProof> {
    if (method.type !== 'mpp') {
      throw new Error(`MPPWallet cannot handle payment method type: ${method.type}`)
    }

    const mppMethod = method as MPPPaymentMethod
    const challengeId = mppMethod.challenge_id

    if (!challengeId) {
      throw new Error('MPP payment method missing challenge_id')
    }

    // Execute payment on the selected network
    let proof: Record<string, string>
    try {
      proof = await this.executePayment(mppMethod, pricing)
    } catch (err) {
      if (err instanceof FacilitatorUnavailableError) {
        throw err
      }
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`MPP payment failed on ${this.network}: ${message}`)
    }

    // Construct credential
    const credential = createCredential({
      challengeId,
      network: this.network,
      proof,
      payer: this.payerIdentifier,
    })

    // Serialize as Authorization header value
    const headerValue = serializeCredential(credential)

    return {
      header: 'Authorization',
      value: headerValue,
    }
  }

  /**
   * Create an MPP session for streaming/aggregated payments.
   *
   * Calls the server's session creation endpoint to authorize a
   * budget for multiple requests.
   *
   * @param serverUrl - The MPP server URL
   * @param config - Session configuration
   * @returns The created session
   */
  async createSession(serverUrl: string, config: MPPSessionConfig): Promise<MPPSession> {
    let response: Response
    try {
      response = await fetch(`${serverUrl}/mpp/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to create MPP session: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `MPP session creation failed (${response.status}): ${body}`
      )
    }

    return (await response.json()) as MPPSession
  }

  /**
   * Get the status of an MPP session.
   *
   * @param serverUrl - The MPP server URL
   * @param sessionId - The session to query
   * @returns The current session state
   */
  async getSessionStatus(serverUrl: string, sessionId: string): Promise<MPPSession> {
    let response: Response
    try {
      response = await fetch(`${serverUrl}/mpp/sessions/${sessionId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to get MPP session status: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `MPP session status request failed (${response.status}): ${body}`
      )
    }

    return (await response.json()) as MPPSession
  }

  // ---------------------------------------------------------------------------
  // Private: Network-specific Payment Execution
  // ---------------------------------------------------------------------------

  /**
   * Executes payment on the configured network and returns proof.
   */
  private async executePayment(
    method: MPPPaymentMethod,
    pricing: Pricing
  ): Promise<Record<string, string>> {
    switch (this.network) {
      case 'tempo':
        return this.payViaTempo(method, pricing)
      case 'stripe':
        return this.payViaStripe(method, pricing)
      case 'lightning':
        return this.payViaLightning(method, pricing)
      default:
        throw new Error(`Unsupported payment network: ${this.network}`)
    }
  }

  /**
   * Executes an on-chain payment via the Tempo network.
   *
   * Submits a transaction to the Tempo RPC endpoint to transfer
   * funds to the recipient address.
   */
  private async payViaTempo(
    method: MPPPaymentMethod,
    pricing: Pricing
  ): Promise<Record<string, string>> {
    if (!this.tempoPrivateKey) {
      throw new Error('Tempo private key is required for Tempo payments')
    }

    const rpcUrl = this.tempoRpcUrl ?? 'https://rpc.tempo.network'

    let response: Response
    try {
      response = await fetch(`${rpcUrl}/v1/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: this.payerIdentifier,
          to: method.recipient,
          amount: pricing.amount,
          currency: pricing.currency,
          // In production, this would include a signed transaction
          // using the private key. Simplified for the adapter pattern.
          privateKey: this.tempoPrivateKey,
        }),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to submit Tempo transaction: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Tempo RPC returned ${response.status}: ${body}`
      )
    }

    const result = (await response.json()) as { transactionHash: string }

    return { transactionHash: result.transactionHash }
  }

  /**
   * Executes a payment via Stripe Shared Payment Token (SPT) flow.
   *
   * Creates a PaymentIntent using the configured payment method and
   * confirms it.
   */
  private async payViaStripe(
    method: MPPPaymentMethod,
    pricing: Pricing
  ): Promise<Record<string, string>> {
    if (!this.stripePaymentMethod) {
      throw new Error('Stripe payment method is required for Stripe payments')
    }

    const serverUrl = method.server_url
    if (!serverUrl) {
      throw new Error('MPP payment method missing server_url for Stripe payments')
    }

    // Request a PaymentIntent from the MPP server
    let response: Response
    try {
      response = await fetch(`${serverUrl}/mpp/stripe/create-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: pricing.amount,
          currency: pricing.currency,
          paymentMethod: this.stripePaymentMethod,
          challengeId: method.challenge_id,
        }),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to create Stripe PaymentIntent via MPP: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `MPP Stripe intent creation failed (${response.status}): ${body}`
      )
    }

    const result = (await response.json()) as { paymentIntentId: string }

    return { paymentIntentId: result.paymentIntentId }
  }

  /**
   * Executes a payment via Lightning Network (BOLT11).
   *
   * Requests an invoice from the MPP server, pays it via the
   * connected Lightning node, and returns the preimage as proof.
   */
  private async payViaLightning(
    method: MPPPaymentMethod,
    pricing: Pricing
  ): Promise<Record<string, string>> {
    if (!this.lightningNodeUrl) {
      throw new Error('Lightning node URL is required for Lightning payments')
    }

    const serverUrl = method.server_url
    if (!serverUrl) {
      throw new Error('MPP payment method missing server_url for Lightning payments')
    }

    // Step 1: Request a BOLT11 invoice from the MPP server
    let invoiceResponse: Response
    try {
      invoiceResponse = await fetch(`${serverUrl}/mpp/lightning/invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: pricing.amount,
          currency: pricing.currency,
          challengeId: method.challenge_id,
        }),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to request Lightning invoice: ${message}`
      )
    }

    if (!invoiceResponse.ok) {
      const body = await invoiceResponse.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `MPP Lightning invoice request failed (${invoiceResponse.status}): ${body}`
      )
    }

    const invoiceResult = (await invoiceResponse.json()) as { paymentRequest: string }

    // Step 2: Pay the invoice via the Lightning node
    let payResponse: Response
    try {
      payResponse = await fetch(`${this.lightningNodeUrl}/v1/channels/transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Grpc-Metadata-macaroon': this.lightningMacaroon ?? '',
        },
        body: JSON.stringify({
          payment_request: invoiceResult.paymentRequest,
        }),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to pay Lightning invoice: ${message}`
      )
    }

    if (!payResponse.ok) {
      const body = await payResponse.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Lightning payment failed (${payResponse.status}): ${body}`
      )
    }

    const payResult = (await payResponse.json()) as { payment_preimage: string }

    return { preimage: payResult.payment_preimage }
  }
}
