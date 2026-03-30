/**
 * @module mpp-adapter
 *
 * Server-side MPP (Machine Payments Protocol) adapter for OpenAgentPay.
 *
 * The MPPAdapter handles the API provider side of the MPP protocol:
 * 1. Issues challenges with payment details and accepted networks
 * 2. Detects credentials in the `Authorization` header
 * 3. Verifies payment proof based on network (Tempo, Stripe, Lightning)
 * 4. Returns receipts with transaction details
 *
 * @example
 * ```typescript
 * import { mpp } from '@openagentpay/adapter-mpp'
 *
 * const adapter = mpp({
 *   networks: ['tempo', 'stripe'],
 *   sessionsSupported: true,
 * })
 *
 * // Use with paywall middleware
 * const paywall = createPaywall({
 *   adapters: [adapter],
 *   recipient: '0xabc...',
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
  AgentPaymentReceipt,
  MPPPaymentMethod,
} from '@openagentpay/core'

import { FacilitatorUnavailableError } from '@openagentpay/core'

import type { MPPAdapterConfig, MPPStreamConfig, MPPStreamMeter, MPPWWWAuthenticateParams, MPPPaymentReceiptHeader } from './types.js'
import { createChallenge, isChallengeExpired, serializeChallenge } from './challenge.js'
import { deserializeCredential, validateCredentialProof } from './credential.js'
import { MPPSessionManager } from './mpp-session.js'
import type { MPPChallenge, MPPCredential } from './types.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default accepted payment networks. */
const DEFAULT_NETWORKS = ['tempo', 'stripe']

/** Default challenge TTL in seconds. */
const DEFAULT_CHALLENGE_TTL = 300

/** Stripe API base URL. */
const STRIPE_API_BASE = 'https://api.stripe.com/v1'

// ---------------------------------------------------------------------------
// Decimal Arithmetic Helpers
// ---------------------------------------------------------------------------

function toMicro(amount: string): bigint {
  const parts = amount.split('.')
  const whole = parts[0] ?? '0'
  const frac = (parts[1] ?? '').padEnd(6, '0').slice(0, 6)
  return BigInt(whole) * 1000000n + BigInt(frac)
}

function fromMicro(micro: bigint): string {
  const isNegative = micro < 0n
  const abs = isNegative ? -micro : micro
  const whole = abs / 1000000n
  const frac = (abs % 1000000n).toString().padStart(6, '0')
  const trimmed = frac.replace(/0+$/, '').padEnd(2, '0')
  const sign = isNegative ? '-' : ''
  return `${sign}${whole}.${trimmed}`
}

// ---------------------------------------------------------------------------
// Receipt ID Generation
// ---------------------------------------------------------------------------

/**
 * Generates a unique receipt ID with an `mpp_` prefix.
 */
function generateReceiptId(): string {
  const timestamp = Date.now().toString(36).padStart(10, '0')
  const chars = '0123456789abcdefghjkmnpqrstvwxyz'
  let random = ''
  for (let i = 0; i < 16; i++) {
    random += chars[Math.floor(Math.random() * chars.length)]
  }
  return `mpp_${timestamp}${random}`
}

// ---------------------------------------------------------------------------
// MPPAdapter
// ---------------------------------------------------------------------------

/**
 * Server-side payment adapter for the Machine Payments Protocol.
 *
 * Implements the full {@link PaymentAdapter} interface for MPP
 * Challenge-Credential-Receipt flows across multiple payment networks.
 *
 * ## Detection
 *
 * Detects MPP credentials in the `Authorization` header with the
 * `MPP` scheme prefix (e.g., `Authorization: MPP eyJ...`).
 *
 * ## Verification
 *
 * Verifies payment proof based on the network used:
 * - **Tempo**: Verifies on-chain transaction via Tempo RPC
 * - **Stripe**: Verifies PaymentIntent via Stripe API
 * - **Lightning**: Verifies BOLT11 payment preimage
 *
 * ## Sessions
 *
 * Supports MPP sessions for streaming/aggregated payments when
 * `sessionsSupported` is enabled.
 */
export class MPPAdapter implements PaymentAdapter {
  /** Adapter type identifier. Always `"mpp"`. */
  readonly type = 'mpp' as const

  private readonly networks: string[]
  private readonly challengeTtlSeconds: number
  private readonly sessionsSupported: boolean
  private readonly streamingSupported: boolean
  private readonly tempoRpcUrl?: string
  private readonly stripeSecretKey?: string
  private readonly lightningNodeUrl?: string
  private readonly lightningMacaroon?: string

  /** In-memory challenge store for validation. */
  private readonly challengeStore = new Map<string, MPPChallenge>()

  /** Maximum number of challenges to store before cleanup. */
  private static readonly MAX_CHALLENGES = 10000

  /** Active streaming meters. */
  private readonly streamMeters = new Map<string, MPPStreamMeter>()

  /** Session manager for MPP sessions. */
  readonly sessionManager: MPPSessionManager

  /**
   * Creates a new MPPAdapter.
   *
   * @param config - MPP adapter configuration
   */
  constructor(config: MPPAdapterConfig = {}) {
    this.networks = config.networks ?? DEFAULT_NETWORKS
    this.challengeTtlSeconds = config.challengeTtlSeconds ?? DEFAULT_CHALLENGE_TTL
    this.sessionsSupported = config.sessionsSupported ?? false
    this.streamingSupported = config.streamingSupported ?? false
    this.tempoRpcUrl = config.tempoRpcUrl
    this.stripeSecretKey = config.stripeSecretKey
    this.lightningNodeUrl = config.lightningNodeUrl
    this.lightningMacaroon = config.lightningMacaroon
    this.sessionManager = new MPPSessionManager()
  }

  /**
   * Detects whether the incoming request carries an MPP credential.
   *
   * Checks for the `Authorization` header containing an MPP credential
   * (starts with `MPP ` followed by a base64-encoded JSON payload).
   *
   * @param req - The incoming HTTP request
   * @returns `true` if the request contains a valid MPP credential header
   */
  detect(req: IncomingRequest): boolean {
    const header = this.getHeader(req, 'authorization')
    if (!header) return false

    try {
      return header.trim().startsWith('MPP ')
    } catch {
      return false
    }
  }

  /**
   * Verifies an MPP credential and the associated payment.
   *
   * Verification steps:
   * 1. Extract and deserialize the credential from the Authorization header
   * 2. Validate that the challengeId matches a known, unexpired challenge
   * 3. Validate the credential has appropriate proof for its network
   * 4. Verify payment on the specific network (Tempo/Stripe/Lightning)
   * 5. Return a receipt with transaction details
   *
   * @param req - The incoming HTTP request with Authorization header
   * @param pricing - The pricing requirements for this endpoint
   * @returns Verification result with receipt data on success
   */
  async verify(req: IncomingRequest, pricing: Pricing): Promise<VerifyResult> {
    const header = this.getHeader(req, 'authorization')
    if (!header) {
      return { valid: false, error: 'Missing Authorization header' }
    }

    // Step 1: Deserialize credential
    let credential: MPPCredential
    try {
      credential = deserializeCredential(header)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { valid: false, error: `Invalid MPP credential: ${message}` }
    }

    // Step 2: Validate challengeId
    const challenge = this.challengeStore.get(credential.challengeId)
    if (!challenge) {
      return { valid: false, error: `Unknown challenge ID: ${credential.challengeId}` }
    }

    if (isChallengeExpired(challenge)) {
      this.challengeStore.delete(credential.challengeId)
      return { valid: false, error: 'Challenge has expired' }
    }

    // Step 3: Validate credential proof format
    if (!validateCredentialProof(credential)) {
      return {
        valid: false,
        error: `Missing or invalid proof for network: ${credential.network}`,
      }
    }

    // Step 4: Verify payment on the specific network
    let transactionRef: string
    try {
      transactionRef = await this.verifyNetworkPayment(credential, challenge)
    } catch (err) {
      if (err instanceof FacilitatorUnavailableError) {
        throw err
      }
      const message = err instanceof Error ? err.message : String(err)
      return { valid: false, error: `Network verification failed: ${message}` }
    }

    // Step 5: Clean up challenge and build receipt
    this.challengeStore.delete(credential.challengeId)

    const path = req.url ?? '/unknown'
    const method = req.method ?? 'GET'
    const now = new Date().toISOString()

    const receipt: Partial<AgentPaymentReceipt> = {
      id: generateReceiptId(),
      version: '1.0',
      timestamp: now,
      payer: {
        type: 'agent',
        identifier: credential.payer,
      },
      payee: {
        identifier: challenge.recipient,
        endpoint: path,
      },
      request: {
        method,
        url: path,
      },
      payment: {
        amount: pricing.amount,
        currency: pricing.currency,
        method: 'mpp',
        transaction_hash: transactionRef,
        network: credential.network,
        status: 'settled',
      },
    }

    return { valid: true, receipt }
  }

  /**
   * Generates the MPP payment method descriptor for 402 responses.
   *
   * Creates a new challenge and returns an {@link MPPPaymentMethod}
   * that tells agents how to pay using the MPP protocol.
   *
   * @param config - Must include `recipient` (the payment recipient)
   * @returns An MPPPaymentMethod with challenge details
   */
  describeMethod(config: AdapterConfig): PaymentMethod {
    const challenge = createChallenge({
      amount: (config['amount'] as string) ?? '0.00',
      currency: (config['currency'] as string) ?? 'USD',
      recipient: config.recipient,
      networks: this.networks,
      ttlSeconds: this.challengeTtlSeconds,
      sessionSupported: this.sessionsSupported,
      streamingSupported: this.streamingSupported,
      resource: config['resource'] as string | undefined,
    })

    this.storeChallenge(challenge)

    const method: MPPPaymentMethod = {
      type: 'mpp',
      challenge_id: challenge.challengeId,
      networks: challenge.networks,
      amount: challenge.amount,
      currency: challenge.currency,
      recipient: challenge.recipient,
      sessions_supported: this.sessionsSupported,
    }

    if (config['server_url']) {
      method.server_url = config['server_url'] as string
    }

    return method
  }

  /**
   * Checks whether this adapter handles the given payment method.
   *
   * @param method - The payment method to check
   * @returns `true` if the method type is `"mpp"`
   */
  supports(method: PaymentMethod): boolean {
    return method.type === 'mpp'
  }

  /**
   * Not applicable on the server side.
   *
   * Use {@link MPPWallet} for client-side payment execution.
   *
   * @throws {Error} Always — server-side adapter cannot initiate payments
   */
  async pay(_method: PaymentMethod, _pricing: Pricing): Promise<PaymentProof> {
    throw new Error(
      'MPPAdapter.pay() is not available on the server side. ' +
      'Use MPPWallet for client-side payment execution.'
    )
  }

  // ---------------------------------------------------------------------------
  // IETF Payment Auth Scheme
  // ---------------------------------------------------------------------------

  /**
   * Build the `WWW-Authenticate: Payment ...` header value per
   * IETF draft-ryan-httpauth-payment.
   *
   * @param config - Adapter config with recipient and pricing info
   * @returns The WWW-Authenticate header value string
   */
  buildWWWAuthenticate(config: AdapterConfig): string {
    const challenge = createChallenge({
      amount: (config['amount'] as string) ?? '0.00',
      currency: (config['currency'] as string) ?? 'USD',
      recipient: config.recipient,
      networks: this.networks,
      ttlSeconds: this.challengeTtlSeconds,
      sessionSupported: this.sessionsSupported,
      streamingSupported: this.streamingSupported,
      resource: config['resource'] as string | undefined,
    })

    this.storeChallenge(challenge)

    const encoded = serializeChallenge(challenge)
    const parts = [
      `realm="${config.recipient}"`,
      `challenge="${encoded}"`,
      `networks="${this.networks.join(',')}"`,
    ]

    if (this.sessionsSupported) {
      parts.push('sessions=true')
    }
    if (this.streamingSupported) {
      parts.push('streaming=true')
    }

    return `Payment ${parts.join(', ')}`
  }

  /**
   * Build a `Payment-Receipt` response header value from receipt data.
   */
  static buildReceiptHeader(receipt: MPPPaymentReceiptHeader): string {
    const encoded = Buffer.from(JSON.stringify(receipt), 'utf-8').toString('base64')
    return `Payment ${encoded}`
  }

  // ---------------------------------------------------------------------------
  // Streaming Support
  // ---------------------------------------------------------------------------

  /**
   * Start a streaming payment meter that charges incrementally
   * against an active session.
   *
   * @param config - Streaming configuration
   * @returns The stream meter
   */
  async startStream(config: MPPStreamConfig): Promise<MPPStreamMeter> {
    // Validate the session exists and is active
    await this.sessionManager.getSessionStatus(config.sessionId)

    const streamId = `mpp_stream_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`

    const meter: MPPStreamMeter = {
      streamId,
      sessionId: config.sessionId,
      chunksCharged: 0,
      totalCharged: '0.00',
      active: true,
    }

    this.streamMeters.set(streamId, meter)
    return meter
  }

  /**
   * Record a chunk in a streaming payment and charge the session.
   *
   * @param streamId - The stream to charge
   * @param amount - Amount per chunk
   * @returns Updated meter state
   */
  async chargeStreamChunk(streamId: string, amount: string): Promise<MPPStreamMeter> {
    const meter = this.streamMeters.get(streamId)
    if (!meter) {
      throw new Error(`Stream not found: ${streamId}`)
    }
    if (!meter.active) {
      throw new Error(`Stream is no longer active: ${streamId}`)
    }

    // Charge the session
    await this.sessionManager.chargeSession(meter.sessionId, amount)

    // Update meter
    meter.chunksCharged++
    const currentMicro = toMicro(meter.totalCharged)
    const chargeMicro = toMicro(amount)
    meter.totalCharged = fromMicro(currentMicro + chargeMicro)

    return { ...meter }
  }

  /**
   * End a streaming payment.
   *
   * @param streamId - The stream to close
   * @returns Final meter state
   */
  async endStream(streamId: string): Promise<MPPStreamMeter> {
    const meter = this.streamMeters.get(streamId)
    if (!meter) {
      throw new Error(`Stream not found: ${streamId}`)
    }

    meter.active = false
    const result = { ...meter }
    this.streamMeters.delete(streamId)
    return result
  }

  /**
   * Get the current state of a stream meter.
   */
  getStreamMeter(streamId: string): MPPStreamMeter | undefined {
    const meter = this.streamMeters.get(streamId)
    return meter ? { ...meter } : undefined
  }

  // ---------------------------------------------------------------------------
  // Private: Challenge Store Management
  // ---------------------------------------------------------------------------

  /**
   * Store a challenge with automatic cleanup when at capacity.
   */
  private storeChallenge(challenge: MPPChallenge): void {
    if (this.challengeStore.size >= MPPAdapter.MAX_CHALLENGES) {
      const now = Date.now()
      for (const [id, ch] of this.challengeStore) {
        if (new Date(ch.expiresAt).getTime() <= now) {
          this.challengeStore.delete(id)
        }
      }
      if (this.challengeStore.size >= MPPAdapter.MAX_CHALLENGES) {
        const entries = [...this.challengeStore.entries()]
        entries.sort((a, b) => new Date(a[1].expiresAt).getTime() - new Date(b[1].expiresAt).getTime())
        const toRemove = entries.slice(0, entries.length - MPPAdapter.MAX_CHALLENGES + 1)
        for (const [id] of toRemove) {
          this.challengeStore.delete(id)
        }
      }
    }
    this.challengeStore.set(challenge.challengeId, challenge)
  }

  // ---------------------------------------------------------------------------
  // Private: Network-specific Verification
  // ---------------------------------------------------------------------------

  /**
   * Verifies payment on the specific network and returns the transaction reference.
   */
  private async verifyNetworkPayment(
    credential: MPPCredential,
    challenge: MPPChallenge
  ): Promise<string> {
    switch (credential.network) {
      case 'tempo':
        return this.verifyTempoPayment(credential, challenge)
      case 'stripe':
        return this.verifyStripePayment(credential, challenge)
      case 'lightning':
        return this.verifyLightningPayment(credential, challenge)
      default:
        throw new Error(`Unsupported payment network: ${credential.network}`)
    }
  }

  /**
   * Verifies a Tempo on-chain payment by checking the transaction hash.
   */
  private async verifyTempoPayment(
    credential: MPPCredential,
    challenge: MPPChallenge
  ): Promise<string> {
    const txHash = credential.proof.transactionHash
    if (!txHash) {
      throw new Error('Missing transaction hash for Tempo payment')
    }

    if (!this.tempoRpcUrl) {
      // In development mode without Tempo RPC, accept the credential
      // with a warning. Production deployments should always configure tempoRpcUrl.
      return txHash
    }

    // Verify the transaction via Tempo RPC
    let response: Response
    try {
      response = await fetch(`${this.tempoRpcUrl}/v1/transactions/${txHash}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to reach Tempo RPC: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Tempo RPC returned ${response.status}: ${body}`
      )
    }

    let tx: { status: string; amount: string; recipient: string };
    try {
      tx = (await response.json()) as { status: string; amount: string; recipient: string }
    } catch {
      throw new Error('Invalid JSON response from Tempo RPC')
    }

    if (tx.status !== 'confirmed' && tx.status !== 'finalized') {
      throw new Error(`Tempo transaction not confirmed: status=${tx.status}`)
    }

    if (tx.recipient !== challenge.recipient) {
      throw new Error(
        `Tempo transaction recipient mismatch: expected ${challenge.recipient}, got ${tx.recipient}`
      )
    }

    // Verify payment amount meets pricing requirement
    const requiredAmount = parseFloat(challenge.amount)
    const paidAmount = parseFloat(tx.amount || '0')
    if (paidAmount < requiredAmount) {
      throw new Error(
        `Payment amount ${tx.amount} is less than required ${challenge.amount}`
      )
    }

    return txHash
  }

  /**
   * Verifies a Stripe PaymentIntent via the Stripe REST API.
   */
  private async verifyStripePayment(
    credential: MPPCredential,
    challenge: MPPChallenge
  ): Promise<string> {
    const paymentIntentId = credential.proof.paymentIntentId
    if (!paymentIntentId) {
      throw new Error('Missing PaymentIntent ID for Stripe payment')
    }

    if (!this.stripeSecretKey) {
      // In development mode without Stripe key, accept the credential.
      return paymentIntentId
    }

    let response: Response
    try {
      response = await fetch(`${STRIPE_API_BASE}/payment_intents/${paymentIntentId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.stripeSecretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to reach Stripe API: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Stripe API returned ${response.status}: ${body}`
      )
    }

    let pi: { id: string; status: string; amount?: number };
    try {
      pi = (await response.json()) as { id: string; status: string; amount?: number }
    } catch {
      throw new Error('Invalid JSON response from Stripe API')
    }

    if (pi.status !== 'succeeded') {
      throw new Error(`Stripe PaymentIntent status is '${pi.status}', expected 'succeeded'`)
    }

    // Verify amount (Stripe amounts are in cents)
    const requiredCents = Math.round(parseFloat(challenge.amount) * 100)
    const paidCents = typeof pi.amount === 'number' ? pi.amount : parseInt(String(pi.amount), 10)
    if (paidCents < requiredCents) {
      throw new Error(
        `Payment amount insufficient. Required: ${requiredCents} cents, received: ${paidCents} cents`
      )
    }

    return paymentIntentId
  }

  /**
   * Verifies a Lightning BOLT11 payment preimage.
   */
  private async verifyLightningPayment(
    credential: MPPCredential,
    _challenge: MPPChallenge
  ): Promise<string> {
    const preimage = credential.proof.preimage
    if (!preimage) {
      throw new Error('Missing preimage for Lightning payment')
    }

    if (!this.lightningNodeUrl) {
      // In development mode without Lightning node, accept the credential.
      return preimage
    }

    // Verify the preimage against the Lightning node
    let response: Response
    try {
      response = await fetch(`${this.lightningNodeUrl}/v1/invoice/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Grpc-Metadata-macaroon': this.lightningMacaroon ?? '',
        },
        body: JSON.stringify({ preimage }),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to reach Lightning node: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Lightning node returned ${response.status}: ${body}`
      )
    }

    let result: { settled: boolean };
    try {
      result = (await response.json()) as { settled: boolean }
    } catch {
      throw new Error('Invalid JSON response from Lightning node')
    }
    if (!result.settled) {
      throw new Error('Lightning payment preimage verification failed: invoice not settled')
    }

    return preimage
  }

  // ---------------------------------------------------------------------------
  // Private: Header Helper
  // ---------------------------------------------------------------------------

  /**
   * Extracts a header value from the request, handling case-insensitive
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
