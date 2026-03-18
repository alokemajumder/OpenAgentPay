/**
 * @module agentcard-bridge
 *
 * AgentCard integration for creating and managing virtual debit cards.
 *
 * AgentCard (agentcard.sh) provides prepaid virtual Visa debit cards
 * that AI agents can use for payments. Each card is single-use and
 * funded with the exact amount needed, preventing overspending.
 *
 * @example
 * ```typescript
 * import { AgentCardBridge } from '@openagentpay/adapter-visa'
 *
 * const bridge = new AgentCardBridge({
 *   apiKey: 'agc_live_...',
 * })
 *
 * // Create a single-use card funded with $10
 * const card = await bridge.createCard({
 *   amount: '10.00',
 *   currency: 'USD',
 *   description: 'API call to weather-service',
 * })
 *
 * console.log(card.cardId)      // 'card_abc123'
 * console.log(card.lastFour)    // '4242'
 * console.log(card.status)      // 'active'
 * ```
 */

import { FacilitatorUnavailableError } from '@openagentpay/core'

import type { AgentCardConfig, CardDetails, CreateCardOptions } from './types.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default AgentCard API URL. */
const DEFAULT_AGENTCARD_URL = 'https://api.agentcard.sh'

// ---------------------------------------------------------------------------
// AgentCardBridge
// ---------------------------------------------------------------------------

/**
 * Bridge to the AgentCard API for creating and managing virtual debit cards.
 *
 * AgentCard provides single-use prepaid Visa debit cards that agents
 * can use for payments. Cards are funded with exact amounts, preventing
 * overspending and providing clear audit trails.
 *
 * ## Card Lifecycle
 *
 * 1. **Create** — Fund a new card with a specific amount
 * 2. **Use** — The card token is used for a single payment
 * 3. **Close** — The card is closed and any remaining balance returned
 *
 * ## Security
 *
 * - Full PAN and CVV are never exposed directly
 * - Card credentials are accessed via tokenized references
 * - Single-use cards prevent unauthorized reuse
 */
export class AgentCardBridge {
  private readonly apiKey: string
  private readonly apiUrl: string

  /**
   * Creates a new AgentCardBridge.
   *
   * @param config - AgentCard configuration
   * @param config.apiKey - AgentCard API key for authentication
   * @param config.apiUrl - AgentCard API URL (default: 'https://api.agentcard.sh')
   */
  constructor(config: AgentCardConfig) {
    if (!config.apiKey) {
      throw new Error('AgentCardBridge requires an apiKey')
    }
    this.apiKey = config.apiKey
    this.apiUrl = config.apiUrl ?? DEFAULT_AGENTCARD_URL
  }

  /**
   * Create a single-use virtual card funded with the exact amount needed.
   *
   * The card is created with a specific funding amount and can only
   * be used for a single transaction up to that amount. This prevents
   * overspending and provides clear cost attribution.
   *
   * @param options - Card creation options
   * @param options.amount - Amount to fund the card with (e.g., '10.00')
   * @param options.currency - Currency code (e.g., 'USD')
   * @param options.description - Human-readable description
   * @param options.metadata - Additional metadata
   * @returns The created card details
   *
   * @example
   * ```typescript
   * const card = await bridge.createCard({
   *   amount: '5.00',
   *   currency: 'USD',
   *   description: 'Payment for search API',
   *   metadata: { agent_id: 'agent-1', task_id: 'task-42' },
   * })
   * ```
   */
  async createCard(options: CreateCardOptions): Promise<CardDetails> {
    const body = {
      amount: options.amount,
      currency: options.currency,
      single_use: true,
      description: options.description,
      metadata: options.metadata,
    }

    const result = await this.apiPost<CardDetails>('/v1/cards', body)
    return result
  }

  /**
   * Get the current balance and status of a card.
   *
   * @param cardId - The card identifier
   * @returns The card's current balance and status
   *
   * @example
   * ```typescript
   * const status = await bridge.getCardStatus('card_abc123')
   * console.log(status.balance)  // '5.00'
   * console.log(status.status)   // 'active'
   * ```
   */
  async getCardStatus(cardId: string): Promise<{ balance: string; status: string }> {
    const card = await this.apiGet<CardDetails>(`/v1/cards/${cardId}`)
    return {
      balance: card.remainingBalance,
      status: card.status,
    }
  }

  /**
   * Close a card and return any remaining balance.
   *
   * Closes the card immediately, preventing further use. Any
   * remaining balance on the card is returned to the funding source.
   *
   * @param cardId - The card identifier
   *
   * @example
   * ```typescript
   * await bridge.closeCard('card_abc123')
   * ```
   */
  async closeCard(cardId: string): Promise<void> {
    await this.apiPost(`/v1/cards/${cardId}/close`, {})
  }

  /**
   * List all cards created by this API key.
   *
   * @returns Array of card details
   *
   * @example
   * ```typescript
   * const cards = await bridge.listCards()
   * for (const card of cards) {
   *   console.log(`${card.cardId}: ${card.status} ($${card.remainingBalance})`)
   * }
   * ```
   */
  async listCards(): Promise<CardDetails[]> {
    const result = await this.apiGet<{ cards: CardDetails[] }>('/v1/cards')
    return result.cards
  }

  /**
   * Get a tokenized reference to a card for use in payment headers.
   *
   * Returns a short-lived token that can be included in the
   * `X-VISA-TOKEN` header without exposing the actual card credentials.
   *
   * @param cardId - The card identifier
   * @returns A tokenized card reference
   */
  async getCardToken(cardId: string): Promise<string> {
    const result = await this.apiPost<{ token: string }>(
      `/v1/cards/${cardId}/tokenize`,
      {}
    )
    return result.token
  }

  // ---------------------------------------------------------------------------
  // Private: API Helpers
  // ---------------------------------------------------------------------------

  /**
   * Makes an authenticated GET request to the AgentCard API.
   */
  private async apiGet<T>(path: string): Promise<T> {
    let response: Response
    try {
      response = await fetch(`${this.apiUrl}${path}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to reach AgentCard API: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `AgentCard API returned ${response.status}: ${body}`
      )
    }

    return response.json() as Promise<T>
  }

  /**
   * Makes an authenticated POST request to the AgentCard API.
   */
  private async apiPost<T>(path: string, body: unknown): Promise<T> {
    let response: Response
    try {
      response = await fetch(`${this.apiUrl}${path}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to reach AgentCard API: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `AgentCard API returned ${response.status}: ${body}`
      )
    }

    return response.json() as Promise<T>
  }
}
