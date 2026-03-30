/**
 * @module payment-tools
 *
 * High-level wrappers around common Razorpay MCP tools.
 *
 * Provides typed methods for payments, orders, refunds, QR codes,
 * and payment links — abstracting the raw MCP tool names and
 * argument schemas into a clean API.
 *
 * @example
 * ```typescript
 * import { RazorpayMCPClient, RazorpayPaymentTools } from '@openagentpay/razorpay-mcp';
 *
 * const client = new RazorpayMCPClient({ apiKeyId: '...', apiKeySecret: '...' });
 * const tools = new RazorpayPaymentTools(client);
 *
 * const link = await tools.createPaymentLink({
 *   amount: 50000,
 *   description: 'API access fee',
 *   upiLink: true,
 * });
 * ```
 *
 * @packageDocumentation
 */

import type { RazorpayMCPClient } from './client.js'
import type {
  RazorpayToolResult,
  MCPReservePayOptions,
  MCPPaymentLinkResult,
} from './types.js'

// ---------------------------------------------------------------------------
// RazorpayPaymentTools
// ---------------------------------------------------------------------------

/**
 * High-level payment tool wrappers for the Razorpay MCP server.
 *
 * Each method maps to one or more Razorpay MCP tools and provides
 * a typed interface with sensible defaults.
 */
export class RazorpayPaymentTools {
  constructor(private readonly client: RazorpayMCPClient) {}

  // -------------------------------------------------------------------------
  // Payment Links
  // -------------------------------------------------------------------------

  /**
   * Create a payment link, optionally with UPI deep-link support.
   *
   * @param options.amount - Amount in paise (e.g. 50000 = Rs 500).
   * @param options.currency - Currency code. Default: 'INR'.
   * @param options.description - Human-readable payment description.
   * @param options.customerContact - Customer phone number (for notifications).
   * @param options.upiLink - Whether to generate a UPI deep-link. Default: false.
   * @returns The MCP tool result with payment link data.
   */
  async createPaymentLink(options: {
    amount: number
    currency?: string
    description: string
    customerContact?: string
    upiLink?: boolean
  }): Promise<RazorpayToolResult> {
    const toolName = options.upiLink
      ? 'create_payment_link_upi'
      : 'create_payment_link'

    const args: Record<string, unknown> = {
      amount: options.amount,
      currency: options.currency ?? 'INR',
      description: options.description,
    }

    if (options.customerContact) {
      args.customer = { contact: options.customerContact }
    }

    if (options.upiLink) {
      args.upi_link = true
    }

    return this.client.callTool(toolName, args)
  }

  // -------------------------------------------------------------------------
  // Payments
  // -------------------------------------------------------------------------

  /**
   * Fetch details of a specific payment.
   *
   * @param paymentId - Razorpay payment ID (e.g. 'pay_...').
   */
  async fetchPayment(paymentId: string): Promise<RazorpayToolResult> {
    return this.client.callTool('fetch_payment', {
      payment_id: paymentId,
    })
  }

  /**
   * Capture an authorized payment.
   *
   * @param paymentId - Razorpay payment ID.
   * @param amount - Amount to capture in paise.
   */
  async capturePayment(
    paymentId: string,
    amount: number,
  ): Promise<RazorpayToolResult> {
    return this.client.callTool('capture_payment', {
      payment_id: paymentId,
      amount,
      currency: 'INR',
    })
  }

  /**
   * Fetch all payments with optional pagination.
   *
   * @param options.count - Number of payments to fetch. Default: 10.
   * @param options.skip - Number of payments to skip. Default: 0.
   */
  async fetchAllPayments(options?: {
    count?: number
    skip?: number
  }): Promise<RazorpayToolResult> {
    return this.client.callTool('fetch_all_payments', {
      count: options?.count ?? 10,
      skip: options?.skip ?? 0,
    })
  }

  // -------------------------------------------------------------------------
  // Refunds
  // -------------------------------------------------------------------------

  /**
   * Create a refund for a payment.
   *
   * @param paymentId - Razorpay payment ID to refund.
   * @param amount - Refund amount in paise. If omitted, full refund.
   * @param reason - Optional reason for the refund.
   */
  async createRefund(
    paymentId: string,
    amount?: number,
    reason?: string,
  ): Promise<RazorpayToolResult> {
    const args: Record<string, unknown> = {
      payment_id: paymentId,
    }

    if (amount != null) {
      args.amount = amount
    }

    if (reason) {
      args.notes = { reason }
    }

    return this.client.callTool('create_refund', args)
  }

  // -------------------------------------------------------------------------
  // Orders
  // -------------------------------------------------------------------------

  /**
   * Create a new Razorpay order.
   *
   * @param amount - Order amount in paise.
   * @param currency - Currency code. Default: 'INR'.
   * @param receipt - Optional receipt identifier for merchant records.
   */
  async createOrder(
    amount: number,
    currency?: string,
    receipt?: string,
  ): Promise<RazorpayToolResult> {
    const args: Record<string, unknown> = {
      amount,
      currency: currency ?? 'INR',
    }

    if (receipt) {
      args.receipt = receipt
    }

    return this.client.callTool('create_order', args)
  }

  // -------------------------------------------------------------------------
  // QR Codes
  // -------------------------------------------------------------------------

  /**
   * Create a UPI QR code for payment collection.
   *
   * @param amount - Amount in paise.
   * @param description - Optional description for the QR code.
   */
  async createQRCode(
    amount: number,
    description?: string,
  ): Promise<RazorpayToolResult> {
    const args: Record<string, unknown> = {
      usage: 'single_use',
      type: 'upi_qr',
      fixed_amount: true,
      payment_amount: amount,
    }

    if (description) {
      args.description = description
    }

    return this.client.callTool('create_qr_code', args)
  }

  /**
   * Fetch details of a QR code.
   *
   * @param qrId - Razorpay QR code ID.
   */
  async fetchQRCode(qrId: string): Promise<RazorpayToolResult> {
    return this.client.callTool('fetch_qr_code', {
      qr_code_id: qrId,
    })
  }

  /**
   * Close (deactivate) a QR code.
   *
   * @param qrId - Razorpay QR code ID.
   */
  async closeQRCode(qrId: string): Promise<RazorpayToolResult> {
    return this.client.callTool('close_qr_code', {
      qr_code_id: qrId,
    })
  }

  // -------------------------------------------------------------------------
  // Reserve Pay (UPI SBMD)
  // -------------------------------------------------------------------------

  /**
   * Create a UPI payment link with Reserve Pay metadata.
   *
   * Reserve Pay (Single Block Multi Debit) allows pre-authorized
   * spending limits for agents. This creates a payment link that
   * the payer can use to authorize a block.
   *
   * @param options - Reserve Pay block options.
   */
  async createReservePayLink(
    options: MCPReservePayOptions,
  ): Promise<RazorpayToolResult> {
    const args: Record<string, unknown> = {
      amount: options.amount,
      currency: 'INR',
      description: options.description,
      upi_link: options.upiLink ?? true,
    }

    if (options.customerContact) {
      args.customer = { contact: options.customerContact }
    }

    if (options.customerEmail) {
      if (args.customer && typeof args.customer === 'object') {
        (args.customer as Record<string, unknown>).email =
          options.customerEmail
      } else {
        args.customer = { email: options.customerEmail }
      }
    }

    if (options.expiryMinutes) {
      const expiresAt = Math.floor(Date.now() / 1000) + options.expiryMinutes * 60
      args.expire_by = expiresAt
    }

    // Add Reserve Pay metadata via notes
    args.notes = {
      openagentpay: 'true',
      type: 'reserve_pay',
      description: options.description,
    }

    return this.client.callTool('create_payment_link_upi', args)
  }

  // -------------------------------------------------------------------------
  // Result Parsing Helpers
  // -------------------------------------------------------------------------

  /**
   * Parse a payment link result from an MCP tool call.
   *
   * Extracts the common payment link fields from the raw tool result.
   */
  static parsePaymentLinkResult(
    result: RazorpayToolResult,
  ): MCPPaymentLinkResult | null {
    if (!result.success || !result.data) return null

    const data = result.data
    return {
      id: String(data.id ?? ''),
      shortUrl: String(data.short_url ?? ''),
      amount: Number(data.amount ?? 0),
      status: String(data.status ?? 'unknown'),
      upiLink: data.upi_link === true,
    }
  }
}
