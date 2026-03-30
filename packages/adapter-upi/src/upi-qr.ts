/**
 * @module upi-qr
 *
 * UPI QR code generation and management for OpenAgentPay.
 *
 * The {@link UPIQRCodeManager} creates UPI QR codes via payment gateway
 * APIs, checks their payment status, and closes/expires them. Supports
 * Razorpay, Cashfree, and generic gateways.
 *
 * @example
 * ```typescript
 * import { UPIQRCodeManager } from '@openagentpay/adapter-upi'
 *
 * const qr = new UPIQRCodeManager({
 *   gateway: 'razorpay',
 *   apiKey: 'rzp_live_...',
 *   apiSecret: 'secret_...',
 * })
 *
 * const result = await qr.createQR({
 *   amount: 50000,  // Rs 500 in paise
 *   description: 'API credits',
 *   expiryMinutes: 30,
 * })
 *
 * console.log(result.qrCodeUrl)  // URL to QR code image
 * ```
 */

import { FacilitatorUnavailableError } from '@openagentpay/core'

import type { UPIQRConfig, QRCodeResult } from './types.js'

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

/** Razorpay QR code response. */
interface RazorpayQRCode {
  id: string
  image_url: string
  qr_string?: string
  payment_amount: number
  status: string
  close_by?: number
  closed_at?: number
}

/** Cashfree QR code response. */
interface CashfreeQRCode {
  qrcode_id: string
  qr_code_url: string
  qr_code?: string
  order_amount: number
  status: string
  expiry?: string
}

/** Generic QR code response. */
interface GenericQRCode {
  id: string
  image_url: string
  qr_data?: string
  amount: number
  status: string
  expires_at?: string
}

// ---------------------------------------------------------------------------
// UPIQRCodeManager
// ---------------------------------------------------------------------------

/**
 * Creates and manages UPI QR codes via payment gateway APIs.
 *
 * ## Supported Gateways
 *
 * - **Razorpay** — `POST /v1/payments/qr_codes` with `type: 'upi_qr'`
 * - **Cashfree** — Uses the Cashfree QR code API
 * - **Generic** — Uses a configurable payment gateway endpoint
 *
 * @example
 * ```typescript
 * const manager = new UPIQRCodeManager({
 *   gateway: 'razorpay',
 *   apiKey: 'rzp_live_...',
 *   apiSecret: 'secret_...',
 * })
 *
 * // Create a QR code
 * const qr = await manager.createQR({ amount: 10000, description: 'Test' })
 *
 * // Check status
 * const status = await manager.getQRStatus(qr.qrId)
 *
 * // Close the QR
 * await manager.closeQR(qr.qrId)
 * ```
 */
export class UPIQRCodeManager {
  /** Payment gateway provider. */
  private readonly gateway: 'razorpay' | 'cashfree' | 'generic'

  /** API key for the gateway. */
  private readonly apiKey: string

  /** API secret for the gateway. */
  private readonly apiSecret: string

  /** Whether to use sandbox environment. */
  private readonly sandbox: boolean

  /**
   * Creates a new UPIQRCodeManager.
   *
   * @param config - QR code manager configuration
   * @throws {Error} If required configuration is missing
   */
  constructor(config: UPIQRConfig) {
    if (!config.apiKey) {
      throw new Error('UPIQRCodeManager requires an apiKey')
    }
    if (!config.apiSecret) {
      throw new Error('UPIQRCodeManager requires an apiSecret')
    }
    if (!config.gateway) {
      throw new Error('UPIQRCodeManager requires a gateway')
    }

    this.gateway = config.gateway
    this.apiKey = config.apiKey
    this.apiSecret = config.apiSecret
    this.sandbox = config.sandbox ?? false
  }

  /**
   * Creates a UPI QR code for accepting payment.
   *
   * @param options - QR code creation options
   * @param options.amount - Amount in paise (e.g. 50000 = Rs 500)
   * @param options.description - Optional description for the payment
   * @param options.payerIdentifier - Optional payer identifier for tracking
   * @param options.expiryMinutes - Optional expiry time in minutes
   * @returns The created QR code details
   * @throws {FacilitatorUnavailableError} If the gateway API is unreachable
   * @throws {Error} If the amount is invalid
   */
  async createQR(options: {
    amount: number
    description?: string
    payerIdentifier?: string
    expiryMinutes?: number
  }): Promise<QRCodeResult> {
    const { amount } = options

    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error(
        `Invalid amount: ${amount}. Must be a positive integer in paise.`
      )
    }

    switch (this.gateway) {
      case 'razorpay':
        return this.createRazorpayQR(options)
      case 'cashfree':
        return this.createCashfreeQR(options)
      case 'generic':
        return this.createGenericQR(options)
      default:
        throw new Error(`Unsupported gateway: ${this.gateway}`)
    }
  }

  /**
   * Checks the payment status of a QR code.
   *
   * @param qrId - The QR code identifier
   * @returns Updated QR code details with payment status
   * @throws {FacilitatorUnavailableError} If the gateway API is unreachable
   */
  async getQRStatus(qrId: string): Promise<QRCodeResult> {
    if (!qrId) {
      throw new Error('qrId is required')
    }

    switch (this.gateway) {
      case 'razorpay':
        return this.getRazorpayQRStatus(qrId)
      case 'cashfree':
        return this.getCashfreeQRStatus(qrId)
      case 'generic':
        return this.getGenericQRStatus(qrId)
      default:
        throw new Error(`Unsupported gateway: ${this.gateway}`)
    }
  }

  /**
   * Closes/expires a QR code so it can no longer accept payments.
   *
   * @param qrId - The QR code identifier to close
   * @throws {FacilitatorUnavailableError} If the gateway API is unreachable
   */
  async closeQR(qrId: string): Promise<void> {
    if (!qrId) {
      throw new Error('qrId is required')
    }

    switch (this.gateway) {
      case 'razorpay':
        await this.closeRazorpayQR(qrId)
        break
      case 'cashfree':
        await this.closeCashfreeQR(qrId)
        break
      case 'generic':
        await this.closeGenericQR(qrId)
        break
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

  private async createRazorpayQR(options: {
    amount: number
    description?: string
    payerIdentifier?: string
    expiryMinutes?: number
  }): Promise<QRCodeResult> {
    const payload: Record<string, unknown> = {
      type: 'upi_qr',
      usage: 'single_use',
      fixed_amount: true,
      payment_amount: options.amount,
      description: options.description ?? 'UPI QR Payment',
    }

    if (options.payerIdentifier) {
      payload.notes = { payer_identifier: options.payerIdentifier }
    }

    if (options.expiryMinutes) {
      // Razorpay close_by is a Unix timestamp
      payload.close_by = Math.floor(Date.now() / 1000) + (options.expiryMinutes * 60)
    }

    let response: Response
    try {
      response = await fetch(`${RAZORPAY_API_BASE}/payments/qr_codes`, {
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
        `Razorpay create QR failed (${response.status}): ${body}`
      )
    }

    const qr = await response.json() as RazorpayQRCode

    return {
      qrId: qr.id,
      qrCodeUrl: qr.image_url,
      qrData: qr.qr_string,
      amount: qr.payment_amount,
      expiresAt: qr.close_by ? new Date(qr.close_by * 1000).toISOString() : undefined,
      status: qr.status,
    }
  }

  private async getRazorpayQRStatus(qrId: string): Promise<QRCodeResult> {
    let response: Response
    try {
      response = await fetch(`${RAZORPAY_API_BASE}/payments/qr_codes/${qrId}`, {
        method: 'GET',
        headers: this.getRazorpayHeaders(),
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
        `Razorpay get QR status failed (${response.status}): ${body}`
      )
    }

    const qr = await response.json() as RazorpayQRCode

    return {
      qrId: qr.id,
      qrCodeUrl: qr.image_url,
      qrData: qr.qr_string,
      amount: qr.payment_amount,
      expiresAt: qr.close_by ? new Date(qr.close_by * 1000).toISOString() : undefined,
      status: qr.status,
    }
  }

  private async closeRazorpayQR(qrId: string): Promise<void> {
    let response: Response
    try {
      response = await fetch(`${RAZORPAY_API_BASE}/payments/qr_codes/${qrId}/close`, {
        method: 'POST',
        headers: this.getRazorpayHeaders(),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to close Razorpay QR: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Razorpay close QR failed (${response.status}): ${body}`
      )
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

  private async createCashfreeQR(options: {
    amount: number
    description?: string
    payerIdentifier?: string
    expiryMinutes?: number
  }): Promise<QRCodeResult> {
    const base = this.getCashfreeBase()

    const payload: Record<string, unknown> = {
      qrcode_id: `qr_${Date.now()}`,
      order_amount: options.amount / 100,  // Cashfree uses INR, not paise
      order_currency: 'INR',
      type: 'static',
    }

    if (options.description) {
      payload.description = options.description
    }

    if (options.payerIdentifier) {
      payload.customer_details = {
        customer_id: options.payerIdentifier,
      }
    }

    if (options.expiryMinutes) {
      const expiryDate = new Date(Date.now() + options.expiryMinutes * 60 * 1000)
      payload.expiry = expiryDate.toISOString()
    }

    let response: Response
    try {
      response = await fetch(`${base}/qrcodes`, {
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
        `Cashfree create QR failed (${response.status}): ${body}`
      )
    }

    const qr = await response.json() as CashfreeQRCode

    return {
      qrId: qr.qrcode_id,
      qrCodeUrl: qr.qr_code_url,
      qrData: qr.qr_code,
      amount: options.amount,
      expiresAt: qr.expiry,
      status: qr.status,
    }
  }

  private async getCashfreeQRStatus(qrId: string): Promise<QRCodeResult> {
    const base = this.getCashfreeBase()

    let response: Response
    try {
      response = await fetch(`${base}/qrcodes/${qrId}`, {
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
        `Cashfree get QR status failed (${response.status}): ${body}`
      )
    }

    const qr = await response.json() as CashfreeQRCode

    return {
      qrId: qr.qrcode_id,
      qrCodeUrl: qr.qr_code_url,
      qrData: qr.qr_code,
      amount: Math.round(qr.order_amount * 100),  // Convert INR to paise
      expiresAt: qr.expiry,
      status: qr.status,
    }
  }

  private async closeCashfreeQR(qrId: string): Promise<void> {
    const base = this.getCashfreeBase()

    let response: Response
    try {
      response = await fetch(`${base}/qrcodes/${qrId}`, {
        method: 'PATCH',
        headers: this.getCashfreeHeaders(),
        body: JSON.stringify({ status: 'TERMINATED' }),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to close Cashfree QR: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Cashfree close QR failed (${response.status}): ${body}`
      )
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Generic Gateway Implementation
  // ---------------------------------------------------------------------------

  private async createGenericQR(options: {
    amount: number
    description?: string
    payerIdentifier?: string
    expiryMinutes?: number
  }): Promise<QRCodeResult> {
    const payload: Record<string, unknown> = {
      amount: options.amount,
      currency: 'INR',
      type: 'upi_qr',
      description: options.description,
      payer_identifier: options.payerIdentifier,
    }

    if (options.expiryMinutes) {
      payload.expiry_minutes = options.expiryMinutes
    }

    let response: Response
    try {
      response = await fetch('https://api.payment-gateway.com/v1/qr-codes', {
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
        `Failed to create QR via generic gateway: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Generic gateway create QR failed (${response.status}): ${body}`
      )
    }

    const qr = await response.json() as GenericQRCode

    return {
      qrId: qr.id,
      qrCodeUrl: qr.image_url,
      qrData: qr.qr_data,
      amount: qr.amount,
      expiresAt: qr.expires_at,
      status: qr.status,
    }
  }

  private async getGenericQRStatus(qrId: string): Promise<QRCodeResult> {
    let response: Response
    try {
      response = await fetch(`https://api.payment-gateway.com/v1/qr-codes/${qrId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to fetch QR status: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Generic gateway get QR status failed (${response.status}): ${body}`
      )
    }

    const qr = await response.json() as GenericQRCode

    return {
      qrId: qr.id,
      qrCodeUrl: qr.image_url,
      qrData: qr.qr_data,
      amount: qr.amount,
      expiresAt: qr.expires_at,
      status: qr.status,
    }
  }

  private async closeGenericQR(qrId: string): Promise<void> {
    let response: Response
    try {
      response = await fetch(`https://api.payment-gateway.com/v1/qr-codes/${qrId}/close`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to close QR: ${message}`
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Generic gateway close QR failed (${response.status}): ${body}`
      )
    }
  }
}
