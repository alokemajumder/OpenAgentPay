/**
 * @module bridge
 *
 * Bridges Razorpay's MCP server with the OpenAgentPay orchestration layer.
 *
 * The bridge provides a higher-level API that maps OpenAgentPay concepts
 * (paid endpoints, payment verification, refunds) to Razorpay MCP tool
 * calls, enabling AI agents to use Razorpay's payment infrastructure
 * through the standard OpenAgentPay flow.
 *
 * @example
 * ```typescript
 * import { RazorpayMCPBridge } from '@openagentpay/razorpay-mcp';
 *
 * const bridge = new RazorpayMCPBridge({
 *   apiKeyId: 'rzp_live_...',
 *   apiKeySecret: 'secret_...',
 * });
 *
 * // Create a payment endpoint for an agent to pay
 * const endpoint = await bridge.createPaidEndpoint({
 *   amount: '500.00',
 *   currency: 'INR',
 * });
 *
 * // Verify the agent's payment
 * const verified = await bridge.verifyPayment('pay_...', '500.00');
 * ```
 *
 * @packageDocumentation
 */

import { RazorpayMCPClient } from './client.js'
import { RazorpayPaymentTools } from './payment-tools.js'
import type {
  RazorpayMCPConfig,
  RazorpayTool,
  RazorpayToolResult,
  MCPPaymentLinkResult,
} from './types.js'

// ---------------------------------------------------------------------------
// RazorpayMCPBridge
// ---------------------------------------------------------------------------

/**
 * Bridge between Razorpay MCP and OpenAgentPay.
 *
 * Provides methods that align with OpenAgentPay's payment lifecycle:
 * endpoint creation, payment verification, and refund processing.
 */
export class RazorpayMCPBridge {
  private readonly client: RazorpayMCPClient
  private readonly tools: RazorpayPaymentTools

  constructor(config: RazorpayMCPConfig) {
    this.client = new RazorpayMCPClient(config)
    this.tools = new RazorpayPaymentTools(this.client)
  }

  // -------------------------------------------------------------------------
  // Paid Endpoint Creation
  // -------------------------------------------------------------------------

  /**
   * Create a UPI payment link that serves as a paid endpoint.
   *
   * This is the Razorpay equivalent of an OpenAgentPay 402 response:
   * the returned link tells the agent where and how much to pay.
   *
   * @param pricing.amount - Amount as a decimal string (e.g. '500.00').
   *   Converted to paise internally (500.00 -> 50000).
   * @param pricing.currency - Currency code. Default: 'INR'.
   * @returns The payment link details, or null if creation failed.
   */
  async createPaidEndpoint(pricing: {
    amount: string
    currency: string
  }): Promise<MCPPaymentLinkResult | null> {
    // Convert decimal string to paise (integer)
    const amountPaise = Math.round(parseFloat(pricing.amount) * 100)

    const result = await this.tools.createPaymentLink({
      amount: amountPaise,
      currency: pricing.currency || 'INR',
      description: `OpenAgentPay endpoint — ${pricing.amount} ${pricing.currency || 'INR'}`,
      upiLink: true,
    })

    return RazorpayPaymentTools.parsePaymentLinkResult(result)
  }

  // -------------------------------------------------------------------------
  // Payment Verification
  // -------------------------------------------------------------------------

  /**
   * Verify that a payment was completed for the expected amount.
   *
   * Fetches the payment from Razorpay via MCP and checks that:
   * - The payment exists and was successfully fetched
   * - The payment status is 'captured' (fully settled)
   * - The payment amount matches the expected amount
   *
   * @param paymentId - Razorpay payment ID (e.g. 'pay_...').
   * @param expectedAmount - Expected amount as a decimal string (e.g. '500.00').
   *   Converted to paise for comparison.
   * @returns Object with verification result and payment data.
   */
  async verifyPayment(
    paymentId: string,
    expectedAmount: string,
  ): Promise<{
    verified: boolean
    reason?: string
    payment?: Record<string, unknown>
  }> {
    const result = await this.tools.fetchPayment(paymentId)

    if (!result.success || !result.data) {
      return {
        verified: false,
        reason: result.error ?? 'Failed to fetch payment from Razorpay.',
      }
    }

    const payment = result.data
    const status = String(payment.status ?? '')

    if (status !== 'captured') {
      return {
        verified: false,
        reason: `Payment status is "${status}", expected "captured".`,
        payment,
      }
    }

    // Compare amounts in paise
    const expectedPaise = Math.round(parseFloat(expectedAmount) * 100)
    const actualPaise = Number(payment.amount ?? 0)

    if (actualPaise !== expectedPaise) {
      return {
        verified: false,
        reason: `Amount mismatch: expected ${expectedPaise} paise, got ${actualPaise} paise.`,
        payment,
      }
    }

    return { verified: true, payment }
  }

  // -------------------------------------------------------------------------
  // Refunds
  // -------------------------------------------------------------------------

  /**
   * Process a refund for a payment via the Razorpay MCP server.
   *
   * @param paymentId - Razorpay payment ID to refund.
   * @param amount - Refund amount as a decimal string (e.g. '250.00').
   *   If omitted, a full refund is issued. Converted to paise internally.
   * @param reason - Optional reason for the refund.
   * @returns The MCP tool result with refund details.
   */
  async processRefund(
    paymentId: string,
    amount?: string,
    reason?: string,
  ): Promise<RazorpayToolResult> {
    const amountPaise = amount
      ? Math.round(parseFloat(amount) * 100)
      : undefined

    return this.tools.createRefund(paymentId, amountPaise, reason)
  }

  // -------------------------------------------------------------------------
  // Tool Discovery & Passthrough
  // -------------------------------------------------------------------------

  /**
   * Get the list of available Razorpay MCP tools.
   *
   * @returns Array of tool descriptors with name, description, and category.
   */
  async getTools(): Promise<RazorpayTool[]> {
    return this.client.listTools()
  }

  /**
   * Call any Razorpay MCP tool by name.
   *
   * This is a raw passthrough to the MCP client, useful for tools
   * that don't have a dedicated high-level wrapper.
   *
   * @param name - The MCP tool name.
   * @param args - Tool arguments as key-value pairs.
   * @returns The raw MCP tool result.
   */
  async callRawTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<RazorpayToolResult> {
    return this.client.callTool(name, args)
  }
}
