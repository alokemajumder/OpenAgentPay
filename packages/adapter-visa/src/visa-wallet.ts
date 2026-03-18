/**
 * @module visa-wallet
 *
 * Client-side Visa wallet for OpenAgentPay.
 *
 * The VisaWallet obtains payment credentials via either:
 * - **Visa MCP**: Calls the Visa Intelligent Commerce MCP server to get
 *   tokenized card credentials for the payment
 * - **AgentCard**: Creates a single-use virtual debit card funded with
 *   the exact amount, then returns the card token
 *
 * @example
 * ```typescript
 * import { visaWallet } from '@openagentpay/adapter-visa'
 *
 * // AgentCard mode — virtual debit cards
 * const wallet = visaWallet({
 *   mode: 'agentcard',
 *   agentcardApiKey: 'agc_live_...',
 * })
 *
 * // Visa MCP mode — tokenized credentials
 * const mcpWallet = visaWallet({
 *   mode: 'mcp',
 *   mcpUrl: 'https://mcp.visa.com',
 * })
 *
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
  VisaPaymentMethod,
} from '@openagentpay/core'

import { FacilitatorUnavailableError } from '@openagentpay/core'

import type { VisaWalletConfig, VisaToken } from './types.js'
import { AgentCardBridge } from './agentcard-bridge.js'
import { VisaAdapter } from './visa-adapter.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default AgentCard API URL. */
const DEFAULT_AGENTCARD_URL = 'https://api.agentcard.sh'

// ---------------------------------------------------------------------------
// VisaWallet
// ---------------------------------------------------------------------------

/**
 * Client-side Visa wallet for making payments.
 *
 * Implements the {@link PaymentAdapter} interface for agents that need
 * to pay for API calls using Visa tokenized credentials.
 *
 * ## MCP Mode
 *
 * Calls the Visa Intelligent Commerce MCP server to obtain tokenized
 * card credentials. The Visa MCP server handles card selection,
 * tokenization, and authorization.
 *
 * ## AgentCard Mode
 *
 * Creates a single-use virtual debit card via AgentCard, funded with
 * the exact amount needed for the payment. This provides strict
 * spending controls and clear audit trails.
 */
export class VisaWallet implements PaymentAdapter {
  /** Adapter type identifier. Always `"visa"`. */
  readonly type = 'visa' as const

  private readonly mode: 'mcp' | 'agentcard'
  private readonly mcpUrl?: string
  private readonly agentcardBridge?: AgentCardBridge

  /**
   * Creates a new VisaWallet.
   *
   * @param config - Wallet configuration
   */
  constructor(config: VisaWalletConfig) {
    this.mode = config.mode

    if (config.mode === 'mcp') {
      this.mcpUrl = config.mcpUrl
      if (!this.mcpUrl) {
        throw new Error('VisaWallet in MCP mode requires mcpUrl')
      }
    } else if (config.mode === 'agentcard') {
      if (!config.agentcardApiKey) {
        throw new Error('VisaWallet in AgentCard mode requires agentcardApiKey')
      }
      this.agentcardBridge = new AgentCardBridge({
        apiKey: config.agentcardApiKey,
        apiUrl: config.agentcardUrl ?? DEFAULT_AGENTCARD_URL,
      })
    }
  }

  /**
   * Not applicable on the client side.
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
   * @throws {Error} Always — use VisaAdapter for server-side verification
   */
  async verify(_req: IncomingRequest, _pricing: Pricing): Promise<VerifyResult> {
    throw new Error(
      'VisaWallet.verify() is not available on the client side. ' +
      'Use VisaAdapter for server-side payment verification.'
    )
  }

  /**
   * Not applicable on the client side.
   *
   * @throws {Error} Always — use VisaAdapter for describing payment methods
   */
  describeMethod(_config: AdapterConfig): PaymentMethod {
    throw new Error(
      'VisaWallet.describeMethod() is not available on the client side. ' +
      'Use VisaAdapter for server-side payment method description.'
    )
  }

  /**
   * Checks whether this wallet can handle the given payment method.
   *
   * Returns `true` for Visa payment methods. In MCP mode, also checks
   * that the method includes an MCP URL. In AgentCard mode, checks
   * for an AgentCard URL.
   *
   * @param method - The payment method to check
   * @returns `true` if this wallet can pay using the method
   */
  supports(method: PaymentMethod): boolean {
    if (method.type !== 'visa') return false

    const visaMethod = method as VisaPaymentMethod

    if (this.mode === 'mcp') {
      // MCP mode supports all Visa methods (prefers MCP URL if available)
      return true
    }

    if (this.mode === 'agentcard') {
      // AgentCard mode supports all Visa methods with tokenized support
      return visaMethod.tokenized !== false
    }

    return false
  }

  /**
   * Execute a payment and return the proof as an X-VISA-TOKEN header.
   *
   * For MCP mode: calls the Visa MCP server to get tokenized credentials.
   * For AgentCard mode: creates a single-use virtual card and returns
   * the card token.
   *
   * @param method - The Visa payment method from the 402 response
   * @param pricing - The pricing requirements
   * @returns PaymentProof with X-VISA-TOKEN header
   */
  async pay(method: PaymentMethod, pricing: Pricing): Promise<PaymentProof> {
    if (method.type !== 'visa') {
      throw new Error(`VisaWallet cannot handle payment method type: ${method.type}`)
    }

    const visaMethod = method as VisaPaymentMethod

    let token: VisaToken
    switch (this.mode) {
      case 'mcp':
        token = await this.payViaMCP(visaMethod, pricing)
        break
      case 'agentcard':
        token = await this.payViaAgentCard(visaMethod, pricing)
        break
      default:
        throw new Error(`Unknown wallet mode: ${this.mode}`)
    }

    const encodedToken = VisaAdapter.encodeToken(token)

    return {
      header: 'X-VISA-TOKEN',
      value: encodedToken,
    }
  }

  // ---------------------------------------------------------------------------
  // Private: MCP Payment
  // ---------------------------------------------------------------------------

  /**
   * Obtains tokenized payment credentials via Visa MCP server.
   */
  private async payViaMCP(
    method: VisaPaymentMethod,
    pricing: Pricing
  ): Promise<VisaToken> {
    const mcpUrl = method.mcp_url ?? this.mcpUrl
    if (!mcpUrl) {
      throw new Error('No Visa MCP URL available for payment')
    }

    // Call the Visa MCP server to get tokenized credentials
    let response: Response
    try {
      response = await fetch(`${mcpUrl}/v1/payments/tokenize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: pricing.amount,
          currency: pricing.currency,
          mcc: method.mcc,
        }),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to reach Visa MCP server: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Visa MCP tokenization failed (${response.status}): ${body}`
      )
    }

    const result = (await response.json()) as {
      token: string;
      expiresAt: string;
    }

    return {
      source: 'mcp',
      token: result.token,
      amount: pricing.amount,
      currency: pricing.currency,
      timestamp: new Date().toISOString(),
    }
  }

  // ---------------------------------------------------------------------------
  // Private: AgentCard Payment
  // ---------------------------------------------------------------------------

  /**
   * Creates a single-use virtual card via AgentCard and returns the token.
   */
  private async payViaAgentCard(
    _method: VisaPaymentMethod,
    pricing: Pricing
  ): Promise<VisaToken> {
    if (!this.agentcardBridge) {
      throw new Error('AgentCard bridge not configured')
    }

    // Create a single-use card funded with the exact amount
    const card = await this.agentcardBridge.createCard({
      amount: pricing.amount,
      currency: pricing.currency,
      description: 'OpenAgentPay payment',
    })

    // Get a tokenized reference to the card
    const cardToken = await this.agentcardBridge.getCardToken(card.cardId)

    return {
      source: 'agentcard',
      token: cardToken,
      cardId: card.cardId,
      amount: pricing.amount,
      currency: pricing.currency,
      timestamp: new Date().toISOString(),
    }
  }
}
