/**
 * @module upi-mandate
 *
 * UPI AutoPay mandate management for OpenAgentPay.
 *
 * The {@link UPIMandateManager} handles the lifecycle of UPI AutoPay
 * mandates, enabling recurring debits from a payer's UPI account
 * without requiring approval for each transaction.
 *
 * Mandates are used for the "direct mode" of fiat payments, where
 * the server charges the agent's UPI account directly per-call
 * (subject to the mandate's maximum amount and frequency).
 *
 * @example
 * ```typescript
 * import { UPIMandateManager } from '@openagentpay/adapter-upi'
 *
 * const manager = new UPIMandateManager({
 *   gateway: 'razorpay',
 *   apiKey: 'rzp_live_...',
 *   apiSecret: 'secret_...',
 *   maxAmount: 500000,  // Rs 5,000 in paise
 *   frequency: 'monthly',
 * })
 *
 * // Create a mandate
 * const { mandateId, authUrl } = await manager.createMandate({
 *   payerIdentifier: 'agent-1',
 *   description: 'OpenAgentPay API credits',
 * })
 *
 * // Execute a debit against the mandate
 * const { transactionId } = await manager.executeMandateDebit({
 *   mandateId,
 *   amount: 10000,  // Rs 100 in paise
 *   description: 'API call batch',
 * })
 * ```
 */

import { FacilitatorUnavailableError } from '@openagentpay/core'

import type { UPIMandateConfig } from './types.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Razorpay API base URL. */
const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1'

/** Cashfree production API base URL. */
const CASHFREE_API_LIVE = 'https://api.cashfree.com/pg'

/** Cashfree sandbox API base URL. */
const CASHFREE_API_SANDBOX = 'https://sandbox.cashfree.com/pg'

// ---------------------------------------------------------------------------
// Gateway Response Shapes
// ---------------------------------------------------------------------------

/** Razorpay subscription/mandate response. */
interface RazorpaySubscription {
  id: string
  status: string
  short_url?: string
  auth_link?: string
}

/** Cashfree subscription response. */
interface CashfreeSubscription {
  subscription_id: string
  status: string
  authorization_link?: string
}

/** Generic mandate response. */
interface GenericMandate {
  id: string
  status: string
  auth_url?: string
}

// ---------------------------------------------------------------------------
// UPIMandateManager
// ---------------------------------------------------------------------------

/**
 * Manages UPI AutoPay mandate lifecycle.
 *
 * UPI AutoPay mandates allow service providers to debit a payer's UPI
 * account on a recurring basis without requiring explicit approval for
 * each transaction. This is similar to card-on-file recurring charges.
 *
 * ## Lifecycle
 *
 * 1. **Create** — generate a mandate with a maximum amount and frequency
 * 2. **Authorize** — payer approves the mandate via their UPI app
 * 3. **Execute** — debit the payer's account (up to the max amount)
 * 4. **Cancel** — terminate the mandate when no longer needed
 *
 * ## Supported Gateways
 *
 * - **Razorpay** — creates subscriptions with `upi` payment method
 * - **Cashfree** — creates subscriptions via the Cashfree API
 * - **Generic** — uses a configurable API endpoint
 *
 * @example
 * ```typescript
 * const manager = new UPIMandateManager({
 *   gateway: 'razorpay',
 *   apiKey: 'rzp_live_...',
 *   apiSecret: 'secret_...',
 *   maxAmount: 100000,  // Rs 1,000
 *   frequency: 'daily',
 * })
 *
 * // Create mandate
 * const { mandateId, authUrl } = await manager.createMandate({
 *   payerVPA: 'agent@upi',
 *   payerIdentifier: 'agent-1',
 *   description: 'API usage charges',
 * })
 *
 * // After authorization, execute debits
 * await manager.executeMandateDebit({
 *   mandateId,
 *   amount: 5000,
 *   description: 'API call batch #42',
 * })
 *
 * // Check mandate status
 * const status = await manager.getMandateStatus(mandateId)
 *
 * // Cancel when done
 * await manager.cancelMandate(mandateId)
 * ```
 */
export class UPIMandateManager {
  /** Payment gateway provider. */
  private readonly gateway: 'razorpay' | 'cashfree' | 'generic'

  /** API key for the gateway. */
  private readonly apiKey: string

  /** API secret for the gateway. */
  private readonly apiSecret: string

  /** Maximum debit amount per transaction in paise. */
  private readonly maxAmount: number

  /** Debit frequency. */
  private readonly frequency: 'daily' | 'weekly' | 'monthly'

  /** Whether to use sandbox environment. */
  private readonly sandbox: boolean

  /**
   * Creates a new UPIMandateManager.
   *
   * @param config - Mandate manager configuration
   * @throws {Error} If required configuration is missing
   */
  constructor(config: UPIMandateConfig) {
    if (!config.apiKey) {
      throw new Error('UPIMandateManager requires an apiKey')
    }
    if (!config.apiSecret) {
      throw new Error('UPIMandateManager requires an apiSecret')
    }
    if (!config.gateway) {
      throw new Error('UPIMandateManager requires a gateway')
    }
    if (!config.maxAmount || config.maxAmount <= 0) {
      throw new Error('UPIMandateManager requires a positive maxAmount')
    }
    if (!config.frequency) {
      throw new Error('UPIMandateManager requires a frequency')
    }

    this.gateway = config.gateway
    this.apiKey = config.apiKey
    this.apiSecret = config.apiSecret
    this.maxAmount = config.maxAmount
    this.frequency = config.frequency
    this.sandbox = config.sandbox ?? false
  }

  /**
   * Creates a new UPI AutoPay mandate.
   *
   * Calls the payment gateway API to create a recurring payment mandate.
   * Returns the mandate ID and an authorization URL where the payer
   * can approve the mandate via their UPI app.
   *
   * @param options - Mandate creation options
   * @param options.payerVPA - Payer's UPI VPA (e.g. "agent@upi"). Optional.
   * @param options.payerIdentifier - Unique identifier for the payer
   * @param options.description - Human-readable description of the mandate
   * @returns The mandate ID and authorization URL
   * @throws {FacilitatorUnavailableError} If the gateway API is unreachable
   */
  async createMandate(options: {
    payerVPA?: string
    payerIdentifier: string
    description: string
  }): Promise<{ mandateId: string; authUrl: string }> {
    const { payerIdentifier, description } = options

    if (!payerIdentifier) {
      throw new Error('payerIdentifier is required')
    }
    if (!description) {
      throw new Error('description is required')
    }

    switch (this.gateway) {
      case 'razorpay':
        return this.createRazorpayMandate(options)
      case 'cashfree':
        return this.createCashfreeMandate(options)
      case 'generic':
        return this.createGenericMandate(options)
      default:
        throw new Error(`Unsupported gateway: ${this.gateway}`)
    }
  }

  /**
   * Executes a debit against an active mandate.
   *
   * Charges the payer's UPI account for the specified amount, which
   * must not exceed the mandate's maximum amount.
   *
   * @param options - Debit execution options
   * @param options.mandateId - The mandate ID to charge against
   * @param options.amount - Amount in paise (e.g. 10000 = Rs 100)
   * @param options.description - Description of the charge
   * @returns The transaction ID and status
   * @throws {Error} If the amount exceeds the mandate maximum
   * @throws {FacilitatorUnavailableError} If the gateway API is unreachable
   */
  async executeMandateDebit(options: {
    mandateId: string
    amount: number
    description: string
  }): Promise<{ transactionId: string; status: string }> {
    const { mandateId, amount, description } = options

    if (!mandateId) {
      throw new Error('mandateId is required')
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error(`Invalid amount: ${amount}. Must be a positive integer in paise.`)
    }
    if (amount > this.maxAmount) {
      throw new Error(
        `Amount ${amount} paise exceeds mandate maximum of ${this.maxAmount} paise`
      )
    }
    if (!description) {
      throw new Error('description is required')
    }

    switch (this.gateway) {
      case 'razorpay':
        return this.executeRazorpayDebit(mandateId, amount, description)
      case 'cashfree':
        return this.executeCashfreeDebit(mandateId, amount, description)
      case 'generic':
        return this.executeGenericDebit(mandateId, amount, description)
      default:
        throw new Error(`Unsupported gateway: ${this.gateway}`)
    }
  }

  /**
   * Cancels an active mandate.
   *
   * After cancellation, no further debits can be executed against
   * this mandate.
   *
   * @param mandateId - The mandate ID to cancel
   * @throws {FacilitatorUnavailableError} If the gateway API is unreachable
   */
  async cancelMandate(mandateId: string): Promise<void> {
    if (!mandateId) {
      throw new Error('mandateId is required')
    }

    switch (this.gateway) {
      case 'razorpay':
        await this.cancelRazorpayMandate(mandateId)
        break
      case 'cashfree':
        await this.cancelCashfreeMandate(mandateId)
        break
      case 'generic':
        await this.cancelGenericMandate(mandateId)
        break
      default:
        throw new Error(`Unsupported gateway: ${this.gateway}`)
    }
  }

  /**
   * Retrieves the current status of a mandate.
   *
   * @param mandateId - The mandate ID to query
   * @returns The mandate status and details
   * @throws {FacilitatorUnavailableError} If the gateway API is unreachable
   */
  async getMandateStatus(mandateId: string): Promise<{ status: string; details: unknown }> {
    if (!mandateId) {
      throw new Error('mandateId is required')
    }

    switch (this.gateway) {
      case 'razorpay':
        return this.getRazorpayMandateStatus(mandateId)
      case 'cashfree':
        return this.getCashfreeMandateStatus(mandateId)
      case 'generic':
        return this.getGenericMandateStatus(mandateId)
      default:
        throw new Error(`Unsupported gateway: ${this.gateway}`)
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Razorpay Implementation
  // ---------------------------------------------------------------------------

  private getBasicAuth(): string {
    return Buffer.from(`${this.apiKey}:${this.apiSecret}`).toString('base64')
  }

  private async createRazorpayMandate(options: {
    payerVPA?: string
    payerIdentifier: string
    description: string
  }): Promise<{ mandateId: string; authUrl: string }> {
    const plan = {
      period: this.frequency === 'daily' ? 'daily' : this.frequency === 'weekly' ? 'weekly' : 'monthly',
      interval: 1,
      item: {
        name: options.description,
        amount: this.maxAmount,
        currency: 'INR',
      },
    }

    // Create plan first
    const planResponse = await this.razorpayPost<{ id: string }>('/plans', plan)

    // Create subscription
    const subscription = {
      plan_id: planResponse.id,
      total_count: 120,  // Maximum billing cycles
      notes: {
        payer_identifier: options.payerIdentifier,
        payer_vpa: options.payerVPA ?? '',
      },
    }

    const sub = await this.razorpayPost<RazorpaySubscription>('/subscriptions', subscription)

    const authUrl = sub.short_url ?? sub.auth_link ?? ''
    if (!authUrl) {
      throw new FacilitatorUnavailableError(
        'Razorpay subscription response missing authorization URL'
      )
    }

    return {
      mandateId: sub.id,
      authUrl,
    }
  }

  private async executeRazorpayDebit(
    mandateId: string,
    amount: number,
    description: string
  ): Promise<{ transactionId: string; status: string }> {
    // Razorpay auto-charges subscriptions on schedule.
    // For on-demand charging, we create an invoice against the subscription.
    const invoice = {
      subscription_id: mandateId,
      type: 'invoice',
      description,
      partial_payment: false,
      line_items: [
        {
          name: description,
          amount,
          currency: 'INR',
          quantity: 1,
        },
      ],
    }

    const result = await this.razorpayPost<{ id: string; status: string }>('/invoices', invoice)

    return {
      transactionId: result.id,
      status: result.status,
    }
  }

  private async cancelRazorpayMandate(mandateId: string): Promise<void> {
    const auth = this.getBasicAuth()

    let response: Response
    try {
      response = await fetch(`${RAZORPAY_API_BASE}/subscriptions/${mandateId}/cancel`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to cancel Razorpay subscription: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Razorpay cancel subscription failed (${response.status}): ${body}`
      )
    }
  }

  private async getRazorpayMandateStatus(mandateId: string): Promise<{ status: string; details: unknown }> {
    const auth = this.getBasicAuth()

    let response: Response
    try {
      response = await fetch(`${RAZORPAY_API_BASE}/subscriptions/${mandateId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to fetch Razorpay subscription status: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Razorpay fetch subscription failed (${response.status}): ${body}`
      )
    }

    const sub = await response.json() as RazorpaySubscription
    return { status: sub.status, details: sub }
  }

  private async razorpayPost<T>(path: string, body: unknown): Promise<T> {
    const auth = this.getBasicAuth()

    let response: Response
    try {
      response = await fetch(`${RAZORPAY_API_BASE}${path}`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to reach Razorpay API: ${message}`
      )
    }

    if (!response.ok) {
      const responseBody = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Razorpay API returned ${response.status}: ${responseBody}`
      )
    }

    return response.json() as Promise<T>
  }

  // ---------------------------------------------------------------------------
  // Private: Cashfree Implementation
  // ---------------------------------------------------------------------------

  private getCashfreeBase(): string {
    return this.sandbox ? CASHFREE_API_SANDBOX : CASHFREE_API_LIVE
  }

  private getCashfreeHeaders(): Record<string, string> {
    return {
      'x-client-id': this.apiKey,
      'x-client-secret': this.apiSecret,
      'x-api-version': '2023-08-01',
      'Content-Type': 'application/json',
    }
  }

  private async createCashfreeMandate(options: {
    payerVPA?: string
    payerIdentifier: string
    description: string
  }): Promise<{ mandateId: string; authUrl: string }> {
    const base = this.getCashfreeBase()

    const subscriptionPayload = {
      subscription_id: `oap_${Date.now()}_${options.payerIdentifier}`,
      plan_id: 'recurring_upi',
      customer_details: {
        customer_id: options.payerIdentifier,
        customer_name: options.payerIdentifier,
      },
      authorization_details: {
        authorization_type: 'MANDATE',
        authorization_amount: this.maxAmount / 100,  // Cashfree uses INR, not paise
        authorization_amount_refund: false,
      },
      subscription_meta: {
        description: options.description,
      },
    }

    let response: Response
    try {
      response = await fetch(`${base}/subscriptions`, {
        method: 'POST',
        headers: this.getCashfreeHeaders(),
        body: JSON.stringify(subscriptionPayload),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to reach Cashfree API: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Cashfree create subscription failed (${response.status}): ${body}`
      )
    }

    const sub = await response.json() as CashfreeSubscription

    return {
      mandateId: sub.subscription_id,
      authUrl: sub.authorization_link ?? '',
    }
  }

  private async executeCashfreeDebit(
    mandateId: string,
    amount: number,
    description: string
  ): Promise<{ transactionId: string; status: string }> {
    const base = this.getCashfreeBase()

    const chargePayload = {
      subscription_id: mandateId,
      payment_amount: amount / 100,  // Cashfree uses INR
      payment_remarks: description,
    }

    let response: Response
    try {
      response = await fetch(`${base}/subscriptions/${mandateId}/payments`, {
        method: 'POST',
        headers: this.getCashfreeHeaders(),
        body: JSON.stringify(chargePayload),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to execute Cashfree subscription charge: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Cashfree charge failed (${response.status}): ${body}`
      )
    }

    const result = await response.json() as { cf_payment_id: string; payment_status: string }

    return {
      transactionId: result.cf_payment_id.toString(),
      status: result.payment_status,
    }
  }

  private async cancelCashfreeMandate(mandateId: string): Promise<void> {
    const base = this.getCashfreeBase()

    let response: Response
    try {
      response = await fetch(`${base}/subscriptions/${mandateId}/cancel`, {
        method: 'POST',
        headers: this.getCashfreeHeaders(),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to cancel Cashfree subscription: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Cashfree cancel subscription failed (${response.status}): ${body}`
      )
    }
  }

  private async getCashfreeMandateStatus(mandateId: string): Promise<{ status: string; details: unknown }> {
    const base = this.getCashfreeBase()

    let response: Response
    try {
      response = await fetch(`${base}/subscriptions/${mandateId}`, {
        method: 'GET',
        headers: this.getCashfreeHeaders(),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to fetch Cashfree subscription status: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Cashfree fetch subscription failed (${response.status}): ${body}`
      )
    }

    const sub = await response.json() as CashfreeSubscription
    return { status: sub.status, details: sub }
  }

  // ---------------------------------------------------------------------------
  // Private: Generic Gateway Implementation
  // ---------------------------------------------------------------------------

  private async createGenericMandate(options: {
    payerVPA?: string
    payerIdentifier: string
    description: string
  }): Promise<{ mandateId: string; authUrl: string }> {
    const mandatePayload = {
      payer_vpa: options.payerVPA,
      payer_identifier: options.payerIdentifier,
      description: options.description,
      max_amount: this.maxAmount,
      frequency: this.frequency,
      currency: 'INR',
    }

    let response: Response
    try {
      response = await fetch('https://api.payment-gateway.com/v1/mandates', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(mandatePayload),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to create mandate via generic gateway: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Generic gateway mandate creation failed (${response.status}): ${body}`
      )
    }

    const mandate = await response.json() as GenericMandate

    return {
      mandateId: mandate.id,
      authUrl: mandate.auth_url ?? '',
    }
  }

  private async executeGenericDebit(
    mandateId: string,
    amount: number,
    description: string
  ): Promise<{ transactionId: string; status: string }> {
    const debitPayload = {
      mandate_id: mandateId,
      amount,
      description,
      currency: 'INR',
    }

    let response: Response
    try {
      response = await fetch('https://api.payment-gateway.com/v1/mandates/debit', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(debitPayload),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to execute mandate debit: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Generic gateway mandate debit failed (${response.status}): ${body}`
      )
    }

    const result = await response.json() as { id: string; status: string }
    return { transactionId: result.id, status: result.status }
  }

  private async cancelGenericMandate(mandateId: string): Promise<void> {
    let response: Response
    try {
      response = await fetch(`https://api.payment-gateway.com/v1/mandates/${mandateId}/cancel`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to cancel mandate: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Generic gateway mandate cancel failed (${response.status}): ${body}`
      )
    }
  }

  private async getGenericMandateStatus(mandateId: string): Promise<{ status: string; details: unknown }> {
    let response: Response
    try {
      response = await fetch(`https://api.payment-gateway.com/v1/mandates/${mandateId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to fetch mandate status: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Generic gateway mandate status failed (${response.status}): ${body}`
      )
    }

    const mandate = await response.json() as GenericMandate
    return { status: mandate.status, details: mandate }
  }
}
