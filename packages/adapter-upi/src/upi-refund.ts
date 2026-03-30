/**
 * @module upi-refund
 *
 * UPI refund management for OpenAgentPay.
 *
 * The {@link UPIRefundManager} creates and tracks refunds for UPI payments
 * via payment gateway APIs. Supports full and partial refunds.
 *
 * @example
 * ```typescript
 * import { UPIRefundManager } from '@openagentpay/adapter-upi'
 *
 * const refunds = new UPIRefundManager({
 *   gateway: 'razorpay',
 *   apiKey: 'rzp_live_...',
 *   apiSecret: 'secret_...',
 * })
 *
 * // Full refund
 * const result = await refunds.createRefund({
 *   paymentId: 'pay_abc123',
 *   reason: 'Customer requested refund',
 * })
 *
 * // Partial refund
 * const partial = await refunds.createRefund({
 *   paymentId: 'pay_abc123',
 *   amount: 5000,  // Rs 50 in paise
 *   reason: 'Partial service failure',
 * })
 *
 * // Check refund status
 * const status = await refunds.getRefundStatus('pay_abc123', result.refundId)
 * ```
 */

import { FacilitatorUnavailableError } from '@openagentpay/core'

import type { UPIRefundConfig, RefundResult } from './types.js'

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

/** Razorpay refund response. */
interface RazorpayRefund {
  id: string
  payment_id: string
  amount: number
  status: string
  created_at: number
}

/** Cashfree refund response. */
interface CashfreeRefund {
  cf_refund_id: string
  cf_payment_id: string
  refund_amount: number
  refund_status: string
  created_at?: string
}

/** Generic gateway refund response. */
interface GenericRefund {
  id: string
  payment_id: string
  amount: number
  status: string
  created_at: string
}

// ---------------------------------------------------------------------------
// UPIRefundManager
// ---------------------------------------------------------------------------

/**
 * Creates and tracks UPI payment refunds via payment gateway APIs.
 *
 * Supports full refunds (entire payment amount) and partial refunds
 * (a specific amount less than the original payment).
 *
 * ## Supported Gateways
 *
 * - **Razorpay** — `POST /v1/payments/{paymentId}/refund` with optional amount
 * - **Cashfree** — `POST /pg/orders/{orderId}/refunds` with refund_amount
 * - **Generic** — Uses a configurable payment gateway endpoint
 *
 * @example
 * ```typescript
 * const manager = new UPIRefundManager({
 *   gateway: 'razorpay',
 *   apiKey: 'rzp_live_...',
 *   apiSecret: 'secret_...',
 * })
 *
 * // Create a refund
 * const refund = await manager.createRefund({
 *   paymentId: 'pay_abc123',
 *   amount: 10000,  // Rs 100 in paise (partial refund)
 *   reason: 'Service not delivered',
 * })
 *
 * // Check refund status
 * const status = await manager.getRefundStatus('pay_abc123', refund.refundId)
 * ```
 */
export class UPIRefundManager {
  /** Payment gateway provider. */
  private readonly gateway: 'razorpay' | 'cashfree' | 'generic'

  /** API key for the gateway. */
  private readonly apiKey: string

  /** API secret for the gateway. */
  private readonly apiSecret: string

  /** Whether to use sandbox environment. */
  private readonly sandbox: boolean

  /**
   * Creates a new UPIRefundManager.
   *
   * @param config - Refund manager configuration
   * @throws {Error} If required configuration is missing
   */
  constructor(config: UPIRefundConfig) {
    if (!config.apiKey) {
      throw new Error('UPIRefundManager requires an apiKey')
    }
    if (!config.apiSecret) {
      throw new Error('UPIRefundManager requires an apiSecret')
    }
    if (!config.gateway) {
      throw new Error('UPIRefundManager requires a gateway')
    }

    this.gateway = config.gateway
    this.apiKey = config.apiKey
    this.apiSecret = config.apiSecret
    this.sandbox = config.sandbox ?? false
  }

  /**
   * Creates a full or partial refund for a UPI payment.
   *
   * If `amount` is omitted, a full refund is initiated. If `amount` is
   * provided, a partial refund for that amount (in paise) is created.
   *
   * @param options - Refund creation options
   * @param options.paymentId - The payment/order ID to refund
   * @param options.amount - Optional amount in paise for partial refund
   * @param options.reason - Optional reason for the refund
   * @returns The refund details
   * @throws {FacilitatorUnavailableError} If the gateway API is unreachable
   * @throws {Error} If the payment ID is missing or amount is invalid
   */
  async createRefund(options: {
    paymentId: string
    amount?: number
    reason?: string
  }): Promise<RefundResult> {
    const { paymentId, amount, reason } = options

    if (!paymentId) {
      throw new Error('paymentId is required')
    }
    if (amount !== undefined && (!Number.isInteger(amount) || amount <= 0)) {
      throw new Error(
        `Invalid refund amount: ${amount}. Must be a positive integer in paise.`
      )
    }

    switch (this.gateway) {
      case 'razorpay':
        return this.createRazorpayRefund(paymentId, amount, reason)
      case 'cashfree':
        return this.createCashfreeRefund(paymentId, amount, reason)
      case 'generic':
        return this.createGenericRefund(paymentId, amount, reason)
      default:
        throw new Error(`Unsupported gateway: ${this.gateway}`)
    }
  }

  /**
   * Retrieves the status of a refund.
   *
   * @param paymentId - The original payment/order ID
   * @param refundId - The refund ID to query
   * @returns The refund details and current status
   * @throws {FacilitatorUnavailableError} If the gateway API is unreachable
   */
  async getRefundStatus(paymentId: string, refundId: string): Promise<RefundResult> {
    if (!paymentId) {
      throw new Error('paymentId is required')
    }
    if (!refundId) {
      throw new Error('refundId is required')
    }

    switch (this.gateway) {
      case 'razorpay':
        return this.getRazorpayRefundStatus(paymentId, refundId)
      case 'cashfree':
        return this.getCashfreeRefundStatus(paymentId, refundId)
      case 'generic':
        return this.getGenericRefundStatus(paymentId, refundId)
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

  private getRazorpayHeaders(): Record<string, string> {
    return {
      'Authorization': `Basic ${this.getBasicAuth()}`,
      'Content-Type': 'application/json',
    }
  }

  private async createRazorpayRefund(
    paymentId: string,
    amount?: number,
    reason?: string
  ): Promise<RefundResult> {
    const payload: Record<string, unknown> = {}

    if (amount !== undefined) {
      payload.amount = amount
    }

    if (reason) {
      payload.notes = { reason }
    }

    let response: Response
    try {
      response = await fetch(`${RAZORPAY_API_BASE}/payments/${paymentId}/refund`, {
        method: 'POST',
        headers: this.getRazorpayHeaders(),
        body: JSON.stringify(payload),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to reach Razorpay API: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Razorpay create refund failed (${response.status}): ${body}`
      )
    }

    const refund = await response.json() as RazorpayRefund

    return {
      refundId: refund.id,
      paymentId: refund.payment_id,
      amount: refund.amount,
      status: refund.status,
      createdAt: new Date(refund.created_at * 1000).toISOString(),
    }
  }

  private async getRazorpayRefundStatus(
    paymentId: string,
    refundId: string
  ): Promise<RefundResult> {
    let response: Response
    try {
      response = await fetch(
        `${RAZORPAY_API_BASE}/payments/${paymentId}/refunds/${refundId}`,
        {
          method: 'GET',
          headers: this.getRazorpayHeaders(),
        }
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to reach Razorpay API: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Razorpay get refund status failed (${response.status}): ${body}`
      )
    }

    const refund = await response.json() as RazorpayRefund

    return {
      refundId: refund.id,
      paymentId: refund.payment_id,
      amount: refund.amount,
      status: refund.status,
      createdAt: new Date(refund.created_at * 1000).toISOString(),
    }
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

  private async createCashfreeRefund(
    orderId: string,
    amount?: number,
    reason?: string
  ): Promise<RefundResult> {
    const base = this.getCashfreeBase()

    const payload: Record<string, unknown> = {
      refund_id: `rfnd_${Date.now()}`,
    }

    if (amount !== undefined) {
      payload.refund_amount = amount / 100  // Cashfree uses INR, not paise
    }

    if (reason) {
      payload.refund_note = reason
    }

    let response: Response
    try {
      response = await fetch(`${base}/orders/${orderId}/refunds`, {
        method: 'POST',
        headers: this.getCashfreeHeaders(),
        body: JSON.stringify(payload),
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
        `Cashfree create refund failed (${response.status}): ${body}`
      )
    }

    const refund = await response.json() as CashfreeRefund

    return {
      refundId: String(refund.cf_refund_id),
      paymentId: String(refund.cf_payment_id),
      amount: Math.round(refund.refund_amount * 100),  // Convert INR to paise
      status: refund.refund_status,
      createdAt: refund.created_at ?? new Date().toISOString(),
    }
  }

  private async getCashfreeRefundStatus(
    orderId: string,
    refundId: string
  ): Promise<RefundResult> {
    const base = this.getCashfreeBase()

    let response: Response
    try {
      response = await fetch(`${base}/orders/${orderId}/refunds/${refundId}`, {
        method: 'GET',
        headers: this.getCashfreeHeaders(),
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
        `Cashfree get refund status failed (${response.status}): ${body}`
      )
    }

    const refund = await response.json() as CashfreeRefund

    return {
      refundId: String(refund.cf_refund_id),
      paymentId: String(refund.cf_payment_id),
      amount: Math.round(refund.refund_amount * 100),  // Convert INR to paise
      status: refund.refund_status,
      createdAt: refund.created_at ?? new Date().toISOString(),
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Generic Gateway Implementation
  // ---------------------------------------------------------------------------

  private async createGenericRefund(
    paymentId: string,
    amount?: number,
    reason?: string
  ): Promise<RefundResult> {
    const payload: Record<string, unknown> = {
      payment_id: paymentId,
    }

    if (amount !== undefined) {
      payload.amount = amount
    }

    if (reason) {
      payload.reason = reason
    }

    let response: Response
    try {
      response = await fetch('https://api.payment-gateway.com/v1/refunds', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to create refund via generic gateway: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Generic gateway create refund failed (${response.status}): ${body}`
      )
    }

    const refund = await response.json() as GenericRefund

    return {
      refundId: refund.id,
      paymentId: refund.payment_id,
      amount: refund.amount,
      status: refund.status,
      createdAt: refund.created_at,
    }
  }

  private async getGenericRefundStatus(
    paymentId: string,
    refundId: string
  ): Promise<RefundResult> {
    let response: Response
    try {
      response = await fetch(
        `https://api.payment-gateway.com/v1/payments/${paymentId}/refunds/${refundId}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to fetch refund status: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Generic gateway get refund status failed (${response.status}): ${body}`
      )
    }

    const refund = await response.json() as GenericRefund

    return {
      refundId: refund.id,
      paymentId: refund.payment_id,
      amount: refund.amount,
      status: refund.status,
      createdAt: refund.created_at,
    }
  }
}
