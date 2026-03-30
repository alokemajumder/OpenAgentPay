/**
 * @module upi-reserve-pay
 *
 * UPI Reserve Pay (SBMD — Single Block Multi Debit) management for
 * OpenAgentPay.
 *
 * The {@link UPIReservePayManager} handles the lifecycle of UPI Reserve Pay
 * blocks, enabling agentic payments where a payer sets a spending limit
 * once (up to Rs 10,000 for 90 days) and agents can make multiple debits
 * without UPI PIN/OTP per transaction. Funds are blocked upfront in the
 * payer's bank account.
 *
 * This differs from UPI AutoPay mandates in that it is a **budget envelope**
 * model (similar to MPP sessions) rather than a recurring schedule.
 *
 * @example
 * ```typescript
 * import { UPIReservePayManager } from '@openagentpay/adapter-upi'
 *
 * const manager = new UPIReservePayManager({
 *   gateway: 'razorpay',
 *   apiKey: 'rzp_live_...',
 *   apiSecret: 'secret_...',
 * })
 *
 * // Create a block (payer authorizes once)
 * const { blockId, authUrl, expiresAt } = await manager.createBlock({
 *   payerVPA: 'user@upi',
 *   payerIdentifier: 'agent-1',
 *   amount: 500000,     // Rs 5,000 in paise
 *   description: 'API usage budget',
 *   expiryDays: 30,
 * })
 *
 * // Execute multiple debits without PIN/OTP
 * const result = await manager.executeDebit(blockId, 10000, 'API call batch')
 * ```
 */

import { FacilitatorUnavailableError } from '@openagentpay/core'

import type {
  UPIReservePayConfig,
  ReservePayBlock,
  ReservePayDebitResult,
} from './types.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum block amount in paise (Rs 10,000). */
const MAX_BLOCK_AMOUNT = 1_000_000

/** Maximum block validity in days. */
const MAX_EXPIRY_DAYS = 90

/** Razorpay API base URL. */
const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1'

/** Cashfree production API base URL. */
const CASHFREE_API_LIVE = 'https://api.cashfree.com/pg'

/** Cashfree sandbox API base URL. */
const CASHFREE_API_SANDBOX = 'https://sandbox.cashfree.com/pg'

// ---------------------------------------------------------------------------
// Gateway Response Shapes
// ---------------------------------------------------------------------------

/** Razorpay payment link response. */
interface RazorpayPaymentLink {
  id: string
  short_url: string
  status: string
}

/** Razorpay payment response. */
interface RazorpayPayment {
  id: string
  status: string
  amount: number
}

/** Cashfree order response. */
interface CashfreeOrder {
  cf_order_id: string
  order_id: string
  order_status: string
  payment_session_id?: string
  payments?: { url?: string }
}

/** Cashfree payment response. */
interface CashfreePayment {
  cf_payment_id: string
  payment_status: string
  payment_amount: number
}

/** Generic gateway block response. */
interface GenericBlockResponse {
  id: string
  status: string
  auth_url?: string
}

/** Generic gateway debit response. */
interface GenericDebitResponse {
  id: string
  status: string
  amount: number
}

// ---------------------------------------------------------------------------
// UPIReservePayManager
// ---------------------------------------------------------------------------

/**
 * Manages UPI Reserve Pay (SBMD) block lifecycle.
 *
 * UPI Reserve Pay allows a payer to authorize a budget envelope — funds
 * are blocked upfront and the agent can execute multiple debits against
 * the block without requiring UPI PIN/OTP for each transaction. This
 * model is ideal for AI agents that make many small, autonomous payments.
 *
 * ## Lifecycle
 *
 * 1. **Create** — create a block with a total budget and expiry
 * 2. **Authorize** — payer approves the block via their UPI app (one-time)
 * 3. **Debit** — agent executes debits against the block (no PIN/OTP)
 * 4. **Cancel** — release remaining funds early if desired
 *
 * ## Supported Gateways
 *
 * - **Razorpay** — uses Payment Links API with Reserve Pay metadata
 * - **Cashfree** — uses Orders API with mandate-style authorization
 * - **Generic** — uses a configurable API endpoint
 *
 * @example
 * ```typescript
 * const manager = new UPIReservePayManager({
 *   gateway: 'razorpay',
 *   apiKey: 'rzp_live_...',
 *   apiSecret: 'secret_...',
 * })
 *
 * // Create block
 * const { blockId, authUrl } = await manager.createBlock({
 *   payerIdentifier: 'agent-1',
 *   amount: 500000,
 *   description: 'API usage budget',
 *   expiryDays: 30,
 * })
 *
 * // After authorization, execute debits
 * await manager.executeDebit(blockId, 5000, 'API call #42')
 *
 * // Check block status
 * const block = await manager.getBlockStatus(blockId)
 * console.log(block.remainingAmount)
 *
 * // Cancel when done
 * await manager.cancelBlock(blockId)
 * ```
 */
export class UPIReservePayManager {
  /** Payment gateway provider. */
  private readonly gateway: 'razorpay' | 'cashfree' | 'generic'

  /** API key for the gateway. */
  private readonly apiKey: string

  /** API secret for the gateway. */
  private readonly apiSecret: string

  /** Whether to use sandbox environment. */
  private readonly sandbox: boolean

  /**
   * In-memory store for block metadata.
   *
   * In production, this should be backed by a persistent store.
   * The in-memory Map is suitable for single-process deployments
   * and testing.
   */
  private readonly blocks: Map<string, ReservePayBlock> = new Map()

  /**
   * Creates a new UPIReservePayManager.
   *
   * @param config - Reserve Pay manager configuration
   * @throws {Error} If required configuration is missing
   */
  constructor(config: UPIReservePayConfig) {
    if (!config.apiKey) {
      throw new Error('UPIReservePayManager requires an apiKey')
    }
    if (!config.apiSecret) {
      throw new Error('UPIReservePayManager requires an apiSecret')
    }
    if (!config.gateway) {
      throw new Error('UPIReservePayManager requires a gateway')
    }

    this.gateway = config.gateway
    this.apiKey = config.apiKey
    this.apiSecret = config.apiSecret
    this.sandbox = config.sandbox ?? false
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Creates a new UPI Reserve Pay (SBMD) block.
   *
   * This initiates a fund-block request. The payer must approve it once
   * via their UPI app using the returned `authUrl`. After approval, the
   * agent can execute multiple debits without further authorization.
   *
   * @param options - Block creation options
   * @param options.payerVPA - Payer's UPI VPA (optional for Razorpay flow)
   * @param options.payerIdentifier - Unique agent/account identifier
   * @param options.amount - Total amount to block in paise (max 1,000,000)
   * @param options.description - Human-readable purpose of the block
   * @param options.expiryDays - Days until block expires (max 90)
   * @returns The block ID, authorization URL, and expiry timestamp
   * @throws {Error} If amount exceeds Rs 10,000 or expiryDays exceeds 90
   * @throws {FacilitatorUnavailableError} If the gateway API is unreachable
   */
  async createBlock(options: {
    payerVPA?: string
    payerIdentifier: string
    amount: number
    description: string
    expiryDays: number
  }): Promise<{ blockId: string; authUrl: string; expiresAt: string }> {
    const { payerIdentifier, amount, description, expiryDays } = options

    // --- Validation ---
    if (!payerIdentifier) {
      throw new Error('payerIdentifier is required')
    }
    if (!description) {
      throw new Error('description is required')
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error(
        `Invalid amount: ${amount}. Must be a positive integer in paise.`
      )
    }
    if (amount > MAX_BLOCK_AMOUNT) {
      throw new Error(
        `Amount ${amount} paise exceeds UPI Reserve Pay maximum of ${MAX_BLOCK_AMOUNT} paise (Rs 10,000)`
      )
    }
    if (!Number.isInteger(expiryDays) || expiryDays <= 0) {
      throw new Error(
        `Invalid expiryDays: ${expiryDays}. Must be a positive integer.`
      )
    }
    if (expiryDays > MAX_EXPIRY_DAYS) {
      throw new Error(
        `expiryDays ${expiryDays} exceeds UPI Reserve Pay maximum of ${MAX_EXPIRY_DAYS} days`
      )
    }

    switch (this.gateway) {
      case 'razorpay':
        return this.createRazorpayBlock(options)
      case 'cashfree':
        return this.createCashfreeBlock(options)
      case 'generic':
        return this.createGenericBlock(options)
      default:
        throw new Error(`Unsupported gateway: ${this.gateway}`)
    }
  }

  /**
   * Executes a debit against an active Reserve Pay block.
   *
   * The debit is processed without requiring UPI PIN/OTP from the payer.
   * The amount must not exceed the block's remaining balance.
   *
   * @param blockId - The block to debit from
   * @param amount - Amount to debit in paise
   * @param description - Description of this debit
   * @returns The debit result with transaction ID and updated balance
   * @throws {Error} If block is not active or amount exceeds remaining balance
   * @throws {FacilitatorUnavailableError} If the gateway API is unreachable
   */
  async executeDebit(
    blockId: string,
    amount: number,
    description: string
  ): Promise<ReservePayDebitResult> {
    if (!blockId) {
      throw new Error('blockId is required')
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error(
        `Invalid amount: ${amount}. Must be a positive integer in paise.`
      )
    }
    if (!description) {
      throw new Error('description is required')
    }

    const block = this.blocks.get(blockId)
    if (!block) {
      throw new Error(`Block not found: ${blockId}`)
    }

    // Check expiry
    if (new Date(block.expiresAt) <= new Date()) {
      block.status = 'expired'
      throw new Error(`Block ${blockId} has expired`)
    }

    if (block.status !== 'active') {
      throw new Error(
        `Block ${blockId} is not active (current status: ${block.status})`
      )
    }
    if (amount > block.remainingAmount) {
      throw new Error(
        `Amount ${amount} paise exceeds remaining balance of ${block.remainingAmount} paise in block ${blockId}`
      )
    }

    switch (this.gateway) {
      case 'razorpay':
        return this.executeRazorpayDebit(block, amount, description)
      case 'cashfree':
        return this.executeCashfreeDebit(block, amount, description)
      case 'generic':
        return this.executeGenericDebit(block, amount, description)
      default:
        throw new Error(`Unsupported gateway: ${this.gateway}`)
    }
  }

  /**
   * Retrieves the current status of a Reserve Pay block.
   *
   * Returns the block with updated amounts. Also checks for expiry
   * and updates the status accordingly.
   *
   * @param blockId - The block to query
   * @returns The current block state
   * @throws {Error} If the block is not found
   */
  async getBlockStatus(blockId: string): Promise<ReservePayBlock> {
    if (!blockId) {
      throw new Error('blockId is required')
    }

    const block = this.blocks.get(blockId)
    if (!block) {
      throw new Error(`Block not found: ${blockId}`)
    }

    // Check expiry
    if (
      block.status !== 'cancelled' &&
      block.status !== 'exhausted' &&
      new Date(block.expiresAt) <= new Date()
    ) {
      block.status = 'expired'
    }

    return { ...block }
  }

  /**
   * Cancels an active Reserve Pay block and releases remaining funds.
   *
   * After cancellation, no further debits can be executed. Any
   * remaining blocked funds are released back to the payer.
   *
   * @param blockId - The block to cancel
   * @throws {Error} If the block is not found or already terminated
   * @throws {FacilitatorUnavailableError} If the gateway API is unreachable
   */
  async cancelBlock(blockId: string): Promise<void> {
    if (!blockId) {
      throw new Error('blockId is required')
    }

    const block = this.blocks.get(blockId)
    if (!block) {
      throw new Error(`Block not found: ${blockId}`)
    }

    if (
      block.status === 'cancelled' ||
      block.status === 'exhausted' ||
      block.status === 'expired'
    ) {
      throw new Error(
        `Block ${blockId} is already terminated (status: ${block.status})`
      )
    }

    switch (this.gateway) {
      case 'razorpay':
        await this.cancelRazorpayBlock(block)
        break
      case 'cashfree':
        await this.cancelCashfreeBlock(block)
        break
      case 'generic':
        await this.cancelGenericBlock(block)
        break
      default:
        throw new Error(`Unsupported gateway: ${this.gateway}`)
    }

    block.status = 'cancelled'
  }

  /**
   * Lists all Reserve Pay blocks, optionally filtered by payer.
   *
   * @param payerIdentifier - If provided, return only blocks for this payer
   * @returns Array of block states (copies, not references)
   */
  async listBlocks(payerIdentifier?: string): Promise<ReservePayBlock[]> {
    const now = new Date()
    const results: ReservePayBlock[] = []

    for (const block of this.blocks.values()) {
      // Update expired blocks
      if (
        block.status !== 'cancelled' &&
        block.status !== 'exhausted' &&
        new Date(block.expiresAt) <= now
      ) {
        block.status = 'expired'
      }

      if (payerIdentifier && block.payerIdentifier !== payerIdentifier) {
        continue
      }

      results.push({ ...block })
    }

    return results
  }

  // ---------------------------------------------------------------------------
  // Private: Razorpay Implementation
  // ---------------------------------------------------------------------------

  private getBasicAuth(): string {
    return Buffer.from(`${this.apiKey}:${this.apiSecret}`).toString('base64')
  }

  private async razorpayRequest<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const auth = this.getBasicAuth()

    const init: RequestInit = {
      method,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
    }

    if (body !== undefined) {
      init.body = JSON.stringify(body)
    }

    let response: Response
    try {
      response = await fetch(`${RAZORPAY_API_BASE}${path}`, init)
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

  private async createRazorpayBlock(options: {
    payerVPA?: string
    payerIdentifier: string
    amount: number
    description: string
    expiryDays: number
  }): Promise<{ blockId: string; authUrl: string; expiresAt: string }> {
    const now = new Date()
    const expiresAt = new Date(now)
    expiresAt.setDate(expiresAt.getDate() + options.expiryDays)

    // Razorpay payment link expiry is in seconds since epoch
    const expireBy = Math.floor(expiresAt.getTime() / 1000)

    const payload = {
      amount: options.amount,
      currency: 'INR',
      description: options.description,
      upi_link: true,
      expire_by: expireBy,
      notes: {
        type: 'reserve_pay_sbmd',
        payer_identifier: options.payerIdentifier,
        payer_vpa: options.payerVPA ?? '',
        total_amount: String(options.amount),
        expiry_days: String(options.expiryDays),
      },
    }

    const link = await this.razorpayRequest<RazorpayPaymentLink>(
      'POST',
      '/payment_links',
      payload
    )

    const blockId = link.id
    const expiresAtIso = expiresAt.toISOString()

    // Store block metadata
    this.blocks.set(blockId, {
      blockId,
      payerVPA: options.payerVPA ?? '',
      payerIdentifier: options.payerIdentifier,
      totalAmount: options.amount,
      spentAmount: 0,
      remainingAmount: options.amount,
      currency: 'INR',
      status: 'created',
      expiresAt: expiresAtIso,
      createdAt: now.toISOString(),
      transactionCount: 0,
    })

    return {
      blockId,
      authUrl: link.short_url,
      expiresAt: expiresAtIso,
    }
  }

  private async executeRazorpayDebit(
    block: ReservePayBlock,
    amount: number,
    description: string
  ): Promise<ReservePayDebitResult> {
    // Create a payment capture against the block.
    // In the Razorpay Reserve Pay flow, the block acts as a pre-authorized
    // fund hold. Each debit is a partial capture against that hold.
    const payload = {
      amount,
      currency: 'INR',
      description,
      notes: {
        type: 'reserve_pay_debit',
        block_id: block.blockId,
        payer_identifier: block.payerIdentifier,
      },
    }

    const payment = await this.razorpayRequest<RazorpayPayment>(
      'POST',
      `/payment_links/${block.blockId}/payments`,
      payload
    )

    const timestamp = new Date().toISOString()

    // Update block tracking
    block.spentAmount += amount
    block.remainingAmount -= amount
    block.transactionCount += 1
    block.lastDebitAt = timestamp

    if (block.remainingAmount === 0) {
      block.status = 'exhausted'
    }

    return {
      transactionId: payment.id,
      amount,
      remainingAmount: block.remainingAmount,
      status: payment.status,
      timestamp,
    }
  }

  private async cancelRazorpayBlock(block: ReservePayBlock): Promise<void> {
    await this.razorpayRequest<RazorpayPaymentLink>(
      'POST',
      `/payment_links/${block.blockId}/cancel`,
      {}
    )
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

  private async cashfreeRequest<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const base = this.getCashfreeBase()

    const init: RequestInit = {
      method,
      headers: this.getCashfreeHeaders(),
    }

    if (body !== undefined) {
      init.body = JSON.stringify(body)
    }

    let response: Response
    try {
      response = await fetch(`${base}${path}`, init)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to reach Cashfree API: ${message}`
      )
    }

    if (!response.ok) {
      const responseBody = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Cashfree API returned ${response.status}: ${responseBody}`
      )
    }

    return response.json() as Promise<T>
  }

  private async createCashfreeBlock(options: {
    payerVPA?: string
    payerIdentifier: string
    amount: number
    description: string
    expiryDays: number
  }): Promise<{ blockId: string; authUrl: string; expiresAt: string }> {
    const now = new Date()
    const expiresAt = new Date(now)
    expiresAt.setDate(expiresAt.getDate() + options.expiryDays)
    const expiresAtIso = expiresAt.toISOString()

    const orderId = `rp_${Date.now()}_${options.payerIdentifier}`

    const payload = {
      order_id: orderId,
      order_amount: options.amount / 100, // Cashfree uses INR, not paise
      order_currency: 'INR',
      order_note: options.description,
      order_meta: {
        payment_methods: 'upi',
        return_url: '',
      },
      customer_details: {
        customer_id: options.payerIdentifier,
        customer_name: options.payerIdentifier,
        customer_phone: '9999999999', // Required by Cashfree
      },
      order_expiry_time: expiresAtIso,
      order_tags: {
        type: 'reserve_pay_sbmd',
        total_amount: String(options.amount),
        expiry_days: String(options.expiryDays),
        payer_vpa: options.payerVPA ?? '',
      },
    }

    const order = await this.cashfreeRequest<CashfreeOrder>(
      'POST',
      '/orders',
      payload
    )

    const blockId = order.order_id ?? orderId
    const authUrl = order.payments?.url ?? ''

    this.blocks.set(blockId, {
      blockId,
      payerVPA: options.payerVPA ?? '',
      payerIdentifier: options.payerIdentifier,
      totalAmount: options.amount,
      spentAmount: 0,
      remainingAmount: options.amount,
      currency: 'INR',
      status: 'created',
      expiresAt: expiresAtIso,
      createdAt: now.toISOString(),
      transactionCount: 0,
    })

    return { blockId, authUrl, expiresAt: expiresAtIso }
  }

  private async executeCashfreeDebit(
    block: ReservePayBlock,
    amount: number,
    description: string
  ): Promise<ReservePayDebitResult> {
    const payload = {
      order_id: block.blockId,
      payment_amount: amount / 100, // Cashfree uses INR
      payment_remarks: description,
      payment_type: 'reserve_pay_debit',
    }

    const payment = await this.cashfreeRequest<CashfreePayment>(
      'POST',
      `/orders/${block.blockId}/payments`,
      payload
    )

    const timestamp = new Date().toISOString()

    block.spentAmount += amount
    block.remainingAmount -= amount
    block.transactionCount += 1
    block.lastDebitAt = timestamp

    if (block.remainingAmount === 0) {
      block.status = 'exhausted'
    }

    return {
      transactionId: payment.cf_payment_id.toString(),
      amount,
      remainingAmount: block.remainingAmount,
      status: payment.payment_status,
      timestamp,
    }
  }

  private async cancelCashfreeBlock(block: ReservePayBlock): Promise<void> {
    await this.cashfreeRequest<unknown>(
      'POST',
      `/orders/${block.blockId}/cancel`,
      {}
    )
  }

  // ---------------------------------------------------------------------------
  // Private: Generic Gateway Implementation
  // ---------------------------------------------------------------------------

  private async genericRequest<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const init: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    }

    if (body !== undefined) {
      init.body = JSON.stringify(body)
    }

    let response: Response
    try {
      response = await fetch(
        `https://api.payment-gateway.com/v1/reserve-pay${path}`,
        init
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      throw new FacilitatorUnavailableError(
        `Failed to reach generic gateway: ${message}`
      )
    }

    if (!response.ok) {
      const responseBody = await response.text().catch(() => 'unknown error')
      throw new FacilitatorUnavailableError(
        `Generic gateway returned ${response.status}: ${responseBody}`
      )
    }

    return response.json() as Promise<T>
  }

  private async createGenericBlock(options: {
    payerVPA?: string
    payerIdentifier: string
    amount: number
    description: string
    expiryDays: number
  }): Promise<{ blockId: string; authUrl: string; expiresAt: string }> {
    const now = new Date()
    const expiresAt = new Date(now)
    expiresAt.setDate(expiresAt.getDate() + options.expiryDays)
    const expiresAtIso = expiresAt.toISOString()

    const payload = {
      payer_vpa: options.payerVPA,
      payer_identifier: options.payerIdentifier,
      amount: options.amount,
      currency: 'INR',
      description: options.description,
      expiry_days: options.expiryDays,
      type: 'sbmd',
    }

    const result = await this.genericRequest<GenericBlockResponse>(
      'POST',
      '/blocks',
      payload
    )

    const blockId = result.id

    this.blocks.set(blockId, {
      blockId,
      payerVPA: options.payerVPA ?? '',
      payerIdentifier: options.payerIdentifier,
      totalAmount: options.amount,
      spentAmount: 0,
      remainingAmount: options.amount,
      currency: 'INR',
      status: 'created',
      expiresAt: expiresAtIso,
      createdAt: now.toISOString(),
      transactionCount: 0,
    })

    return {
      blockId,
      authUrl: result.auth_url ?? '',
      expiresAt: expiresAtIso,
    }
  }

  private async executeGenericDebit(
    block: ReservePayBlock,
    amount: number,
    description: string
  ): Promise<ReservePayDebitResult> {
    const payload = {
      block_id: block.blockId,
      amount,
      currency: 'INR',
      description,
    }

    const result = await this.genericRequest<GenericDebitResponse>(
      'POST',
      `/blocks/${block.blockId}/debit`,
      payload
    )

    const timestamp = new Date().toISOString()

    block.spentAmount += amount
    block.remainingAmount -= amount
    block.transactionCount += 1
    block.lastDebitAt = timestamp

    if (block.remainingAmount === 0) {
      block.status = 'exhausted'
    }

    return {
      transactionId: result.id,
      amount,
      remainingAmount: block.remainingAmount,
      status: result.status,
      timestamp,
    }
  }

  private async cancelGenericBlock(block: ReservePayBlock): Promise<void> {
    await this.genericRequest<unknown>(
      'POST',
      `/blocks/${block.blockId}/cancel`,
      {}
    )
  }

  // ---------------------------------------------------------------------------
  // Block Status Activation
  // ---------------------------------------------------------------------------

  /**
   * Activates a block after payer authorization.
   *
   * Call this method from your webhook handler after receiving confirmation
   * that the payer has authorized the block via their UPI app.
   *
   * @param blockId - The block to activate
   * @throws {Error} If block is not found or not in 'created'/'authorized' status
   */
  activateBlock(blockId: string): void {
    const block = this.blocks.get(blockId)
    if (!block) {
      throw new Error(`Block not found: ${blockId}`)
    }
    if (block.status !== 'created' && block.status !== 'authorized') {
      throw new Error(
        `Cannot activate block ${blockId} with status: ${block.status}`
      )
    }
    block.status = 'active'
  }
}
