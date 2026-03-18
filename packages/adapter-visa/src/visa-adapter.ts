/**
 * @module visa-adapter
 *
 * Server-side Visa Intelligent Commerce adapter for OpenAgentPay.
 *
 * The VisaAdapter handles the API provider side of Visa payments:
 * 1. Detects `X-VISA-TOKEN` headers containing tokenized card credentials
 * 2. Verifies tokenized payments via a payment gateway
 * 3. Returns receipts with Visa transaction details
 *
 * Supports two token sources:
 * - **Visa MCP**: Tokenized credentials from Visa's Intelligent Commerce MCP server
 * - **AgentCard**: Tokenized references to prepaid virtual debit cards
 *
 * @example
 * ```typescript
 * import { visa } from '@openagentpay/adapter-visa'
 *
 * const adapter = visa({
 *   mcpUrl: 'https://mcp.visa.com',
 *   agentcardUrl: 'https://api.agentcard.sh',
 *   gatewayApiKey: 'gw_live_...',
 * })
 *
 * const paywall = createPaywall({
 *   adapters: [adapter],
 *   recipient: 'merchant-id',
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
  VisaPaymentMethod,
} from '@openagentpay/core'

import { FacilitatorUnavailableError } from '@openagentpay/core'

import type { VisaAdapterConfig, VisaToken } from './types.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** HTTP header name for Visa payment tokens. */
const VISA_HEADER = 'x-visa-token'

/** Default AgentCard API URL. */
const DEFAULT_AGENTCARD_URL = 'https://api.agentcard.sh'

// ---------------------------------------------------------------------------
// Receipt ID Generation
// ---------------------------------------------------------------------------

/**
 * Generates a unique receipt ID with a `visa_` prefix.
 */
function generateReceiptId(): string {
  const timestamp = Date.now().toString(36).padStart(10, '0')
  const chars = '0123456789abcdefghjkmnpqrstvwxyz'
  let random = ''
  for (let i = 0; i < 16; i++) {
    random += chars[Math.floor(Math.random() * chars.length)]
  }
  return `visa_${timestamp}${random}`
}

// ---------------------------------------------------------------------------
// Amount Conversion
// ---------------------------------------------------------------------------

/**
 * Converts a decimal string (e.g., "5.00") to cents (e.g., 500).
 */
function decimalToCents(amount: string): number {
  const parts = amount.split('.')
  const dollars = parseInt(parts[0] ?? '0', 10)
  const centsStr = (parts[1] ?? '00').padEnd(2, '0').slice(0, 2)
  const cents = parseInt(centsStr, 10)
  return dollars * 100 + cents
}

/**
 * Converts cents to a decimal string.
 */
function centsToDecimal(cents: number): string {
  const dollars = Math.floor(cents / 100)
  const remainder = cents % 100
  return `${dollars}.${remainder.toString().padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// VisaAdapter
// ---------------------------------------------------------------------------

/**
 * Server-side payment adapter for Visa Intelligent Commerce.
 *
 * Implements the full {@link PaymentAdapter} interface for verifying
 * Visa tokenized card payments, supporting both Visa MCP and AgentCard
 * token sources.
 *
 * ## Detection
 *
 * Detects Visa payments via the `X-VISA-TOKEN` header. The header
 * contains a base64-encoded JSON token with source, token value,
 * and optional amount/currency information.
 *
 * ## Verification
 *
 * For **Visa MCP** tokens: forwards the token to the Visa MCP server
 * for verification and charge processing.
 *
 * For **AgentCard** tokens: verifies the card token and charges
 * against the virtual card balance via the AgentCard API.
 *
 * In **development mode** (no gateway configured): validates token
 * format and returns success without actual charge processing.
 */
export class VisaAdapter implements PaymentAdapter {
  /** Adapter type identifier. Always `"visa"`. */
  readonly type = 'visa' as const

  private readonly mcpUrl?: string
  private readonly agentcardUrl: string
  private readonly gatewayApiKey?: string
  private readonly gatewayUrl?: string
  private readonly mcc?: string

  /**
   * Creates a new VisaAdapter.
   *
   * @param config - Visa adapter configuration
   */
  constructor(config: VisaAdapterConfig = {}) {
    this.mcpUrl = config.mcpUrl
    this.agentcardUrl = config.agentcardUrl ?? DEFAULT_AGENTCARD_URL
    this.gatewayApiKey = config.gatewayApiKey
    this.gatewayUrl = config.gatewayUrl
    this.mcc = config.mcc
  }

  /**
   * Detects whether the incoming request carries a Visa payment token.
   *
   * Checks for the `X-VISA-TOKEN` header containing a base64-encoded
   * JSON payload with token details.
   *
   * @param req - The incoming HTTP request
   * @returns `true` if the request contains a Visa payment token
   */
  detect(req: IncomingRequest): boolean {
    const header = this.getHeader(req, VISA_HEADER)
    if (typeof header !== 'string' || header.length === 0) return false

    try {
      const token = this.decodeToken(header)
      return token.source === 'mcp' || token.source === 'agentcard'
    } catch {
      return false
    }
  }

  /**
   * Verifies a Visa tokenized payment.
   *
   * Decodes the token from the `X-VISA-TOKEN` header and processes
   * the payment based on the token source (MCP or AgentCard).
   *
   * @param req - The incoming HTTP request with the `X-VISA-TOKEN` header
   * @param pricing - The pricing requirements for this endpoint
   * @returns Verification result with optional partial receipt
   */
  async verify(req: IncomingRequest, pricing: Pricing): Promise<VerifyResult> {
    const header = this.getHeader(req, VISA_HEADER)
    if (!header) {
      return { valid: false, error: 'Missing X-VISA-TOKEN header' }
    }

    let token: VisaToken
    try {
      token = this.decodeToken(header)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { valid: false, error: `Invalid Visa token: ${message}` }
    }

    try {
      switch (token.source) {
        case 'mcp':
          return await this.verifyMCPToken(token, pricing, req)
        case 'agentcard':
          return await this.verifyAgentCardToken(token, pricing, req)
        default:
          return { valid: false, error: `Unknown token source: ${token.source}` }
      }
    } catch (err) {
      if (err instanceof FacilitatorUnavailableError) {
        throw err
      }
      const message = err instanceof Error ? err.message : 'Unknown verification error'
      return { valid: false, error: message }
    }
  }

  /**
   * Generates the Visa payment method descriptor for 402 responses.
   *
   * Returns a {@link VisaPaymentMethod} that tells agents how to pay
   * via Visa MCP or AgentCard.
   *
   * @param _config - Adapter configuration
   * @returns A VisaPaymentMethod for inclusion in the 402 response
   */
  describeMethod(_config: AdapterConfig): PaymentMethod {
    const method: VisaPaymentMethod = {
      type: 'visa',
      tokenized: true,
    }

    if (this.mcpUrl) {
      method.mcp_url = this.mcpUrl
    }
    if (this.agentcardUrl) {
      method.agentcard_url = this.agentcardUrl
    }
    if (this.mcc) {
      method.mcc = this.mcc
    }

    return method
  }

  /**
   * Checks whether this adapter handles the given payment method.
   *
   * @param method - The payment method to check
   * @returns `true` if the method type is `"visa"`
   */
  supports(method: PaymentMethod): boolean {
    return method.type === 'visa'
  }

  /**
   * Not applicable on the server side.
   *
   * Use {@link VisaWallet} for client-side payment execution.
   *
   * @throws {Error} Always — server-side adapter cannot initiate payments
   */
  async pay(_method: PaymentMethod, _pricing: Pricing): Promise<PaymentProof> {
    throw new Error(
      'VisaAdapter.pay() is not available on the server side. ' +
      'Use VisaWallet for client-side payment execution.'
    )
  }

  // ---------------------------------------------------------------------------
  // Private: Token Decoding
  // ---------------------------------------------------------------------------

  /**
   * Decodes a Visa token from the base64-encoded header value.
   */
  private decodeToken(headerValue: string): VisaToken {
    let json: string
    try {
      if (typeof Buffer !== 'undefined') {
        json = Buffer.from(headerValue, 'base64').toString('utf-8')
      } else {
        json = atob(headerValue)
      }
    } catch {
      throw new Error('Failed to decode base64 token')
    }

    const parsed = JSON.parse(json) as VisaToken

    if (!parsed.source || !parsed.token || !parsed.timestamp) {
      throw new Error('Invalid Visa token: missing required fields (source, token, timestamp)')
    }

    return parsed
  }

  /**
   * Encodes a Visa token to a base64 string for the X-VISA-TOKEN header.
   */
  static encodeToken(token: VisaToken): string {
    const json = JSON.stringify(token)
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(json, 'utf-8').toString('base64')
    }
    return btoa(json)
  }

  // ---------------------------------------------------------------------------
  // Private: Visa MCP Token Verification
  // ---------------------------------------------------------------------------

  /**
   * Verifies a token obtained via Visa MCP and processes the charge.
   */
  private async verifyMCPToken(
    token: VisaToken,
    pricing: Pricing,
    req: IncomingRequest
  ): Promise<VerifyResult> {
    if (!this.mcpUrl && !this.gatewayUrl) {
      // Development mode: validate format and return success
      return {
        valid: true,
        receipt: this.buildReceipt(
          pricing.amount,
          pricing.currency,
          `visa_mcp_${token.token.slice(0, 16)}`,
          'visa-mcp-payer',
          req
        ),
      }
    }

    // Verify token with Visa MCP server
    const verifyUrl = this.mcpUrl
      ? `${this.mcpUrl}/v1/tokens/verify`
      : `${this.gatewayUrl}/visa/verify`

    let response: Response
    try {
      response = await fetch(verifyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.gatewayApiKey ? { 'Authorization': `Bearer ${this.gatewayApiKey}` } : {}),
        },
        body: JSON.stringify({
          token: token.token,
          amount: decimalToCents(pricing.amount),
          currency: pricing.currency,
          mcc: this.mcc,
        }),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to verify Visa MCP token: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Visa MCP verification failed (${response.status}): ${body}`
      )
    }

    const result = (await response.json()) as {
      approved: boolean;
      transactionId: string;
      error?: string;
    }

    if (!result.approved) {
      return {
        valid: false,
        error: result.error ?? 'Visa MCP token verification declined',
      }
    }

    return {
      valid: true,
      receipt: this.buildReceipt(
        pricing.amount,
        pricing.currency,
        result.transactionId,
        'visa-mcp-payer',
        req
      ),
    }
  }

  // ---------------------------------------------------------------------------
  // Private: AgentCard Token Verification
  // ---------------------------------------------------------------------------

  /**
   * Verifies an AgentCard token and charges the virtual card.
   */
  private async verifyAgentCardToken(
    token: VisaToken,
    pricing: Pricing,
    req: IncomingRequest
  ): Promise<VerifyResult> {
    if (!this.gatewayApiKey && !this.gatewayUrl) {
      // Development mode: validate format and return success
      return {
        valid: true,
        receipt: this.buildReceipt(
          pricing.amount,
          pricing.currency,
          `visa_ac_${token.cardId ?? token.token.slice(0, 16)}`,
          'agentcard-payer',
          req
        ),
      }
    }

    // Charge the AgentCard via the payment gateway
    const chargeUrl = this.gatewayUrl
      ? `${this.gatewayUrl}/charges`
      : `${this.agentcardUrl}/v1/charges`

    let response: Response
    try {
      response = await fetch(chargeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.gatewayApiKey}`,
        },
        body: JSON.stringify({
          token: token.token,
          card_id: token.cardId,
          amount: decimalToCents(pricing.amount),
          currency: pricing.currency,
          description: `OpenAgentPay charge for ${req.url ?? '/unknown'}`,
        }),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to charge AgentCard: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `AgentCard charge failed (${response.status}): ${body}`
      )
    }

    const result = (await response.json()) as {
      approved: boolean;
      chargeId: string;
      remainingBalance: string;
      error?: string;
    }

    if (!result.approved) {
      return {
        valid: false,
        error: result.error ?? 'AgentCard charge declined',
      }
    }

    return {
      valid: true,
      receipt: this.buildReceipt(
        pricing.amount,
        pricing.currency,
        result.chargeId,
        token.cardId ?? 'agentcard-payer',
        req
      ),
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Receipt Builder
  // ---------------------------------------------------------------------------

  /**
   * Builds a partial receipt from verified payment data.
   */
  private buildReceipt(
    amount: string,
    currency: string,
    transactionRef: string,
    payerIdentifier: string,
    req: IncomingRequest
  ): Partial<AgentPaymentReceipt> {
    const path = req.url ?? '/unknown'
    const method = req.method ?? 'GET'
    const now = new Date().toISOString()

    return {
      id: generateReceiptId(),
      version: '1.0',
      timestamp: now,
      payer: {
        type: 'agent',
        identifier: payerIdentifier,
      },
      payee: {
        identifier: 'visa-provider',
        endpoint: path,
      },
      request: {
        method,
        url: path,
      },
      payment: {
        amount,
        currency: currency.toUpperCase(),
        method: 'visa',
        transaction_hash: transactionRef,
        status: 'settled',
      },
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Header Helper
  // ---------------------------------------------------------------------------

  /**
   * Extracts a header value from the request.
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
