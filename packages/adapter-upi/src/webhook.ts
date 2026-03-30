/**
 * @module webhook
 *
 * Webhook signature verification for UPI payment gateway callbacks.
 *
 * The {@link UPIWebhookVerifier} validates incoming webhook requests from
 * Razorpay or Cashfree by computing an HMAC-SHA256 signature of the raw
 * request body and comparing it against the signature header using
 * constant-time comparison.
 *
 * @example
 * ```typescript
 * import { UPIWebhookVerifier } from '@openagentpay/adapter-upi'
 *
 * const verifier = new UPIWebhookVerifier({
 *   gateway: 'razorpay',
 *   webhookSecret: 'whsec_...',
 * })
 *
 * // In your webhook handler:
 * app.post('/webhook', (req, res) => {
 *   const signature = req.headers['x-razorpay-signature'] as string
 *   const event = verifier.parseEvent(req.rawBody, signature)
 *
 *   if (!event.verified) {
 *     return res.status(401).send('Invalid signature')
 *   }
 *
 *   console.log('Verified event:', event.event, event.id)
 *   res.status(200).send('ok')
 * })
 * ```
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

import type { WebhookVerifierConfig, WebhookEvent } from './types.js'

// ---------------------------------------------------------------------------
// Hex Helper
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

// ---------------------------------------------------------------------------
// UPIWebhookVerifier
// ---------------------------------------------------------------------------

/**
 * Verifies webhook signatures from UPI payment gateways.
 *
 * Uses HMAC-SHA256 with the configured webhook secret and constant-time
 * comparison to prevent timing attacks.
 *
 * ## Supported Gateways
 *
 * - **Razorpay** — HMAC-SHA256 of raw body, compared against `X-Razorpay-Signature`
 * - **Cashfree** — HMAC-SHA256 of raw body, compared against `x-cashfree-signature`
 * - **Generic** — HMAC-SHA256 of raw body (same algorithm as Razorpay)
 *
 * @example
 * ```typescript
 * const verifier = new UPIWebhookVerifier({
 *   gateway: 'razorpay',
 *   webhookSecret: 'whsec_...',
 * })
 *
 * const isValid = verifier.verify(rawBody, signatureHeader)
 * ```
 */
export class UPIWebhookVerifier {
  /** Payment gateway provider. */
  private readonly gateway: 'razorpay' | 'cashfree' | 'generic'

  /** Webhook secret for HMAC computation. */
  private readonly webhookSecret: string

  /**
   * Creates a new UPIWebhookVerifier.
   *
   * @param config - Webhook verifier configuration
   * @throws {Error} If required configuration is missing
   */
  constructor(config: WebhookVerifierConfig) {
    if (!config.gateway) {
      throw new Error('UPIWebhookVerifier requires a gateway')
    }
    if (!config.webhookSecret) {
      throw new Error('UPIWebhookVerifier requires a webhookSecret')
    }

    this.gateway = config.gateway
    this.webhookSecret = config.webhookSecret
  }

  /**
   * Verifies a webhook signature against the raw request body.
   *
   * Computes HMAC-SHA256 of the raw body using the webhook secret and
   * compares it against the provided signature using constant-time
   * comparison to prevent timing attacks.
   *
   * @param body - The raw request body as a string
   * @param signature - The signature from the webhook header
   * @returns `true` if the signature is valid
   *
   * @example
   * ```typescript
   * const sig = req.headers['x-razorpay-signature'] as string
   * if (!verifier.verify(rawBody, sig)) {
   *   return res.status(401).send('Invalid signature')
   * }
   * ```
   */
  verify(body: string, signature: string): boolean {
    if (!body || !signature) {
      return false
    }

    const expectedSignature = createHmac('sha256', this.webhookSecret)
      .update(body)
      .digest('hex')

    // Constant-time comparison to prevent timing attacks
    const sigBuffer = hexToBytes(signature)
    const expectedBuffer = hexToBytes(expectedSignature)

    if (sigBuffer.length !== expectedBuffer.length) {
      return false
    }

    return timingSafeEqual(sigBuffer, expectedBuffer)
  }

  /**
   * Verifies the webhook signature and parses the body into a
   * {@link WebhookEvent}.
   *
   * Extracts the event ID, type, and payload from the parsed JSON body.
   * The `verified` field indicates whether the signature check passed.
   *
   * @param body - The raw request body as a string
   * @param signature - The signature from the webhook header
   * @returns A parsed {@link WebhookEvent} with verification status
   *
   * @example
   * ```typescript
   * const event = verifier.parseEvent(rawBody, signature)
   * if (event.verified && event.event === 'payment.captured') {
   *   // Process the payment
   * }
   * ```
   */
  parseEvent(body: string, signature: string): WebhookEvent {
    const verified = this.verify(body, signature)

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(body) as Record<string, unknown>
    } catch {
      return {
        id: 'unknown',
        event: 'unknown',
        payload: {},
        verified,
        timestamp: new Date().toISOString(),
      }
    }

    switch (this.gateway) {
      case 'razorpay':
        return this.parseRazorpayEvent(parsed, verified)
      case 'cashfree':
        return this.parseCashfreeEvent(parsed, verified)
      case 'generic':
      default:
        return this.parseGenericEvent(parsed, verified)
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Gateway-specific Parsers
  // ---------------------------------------------------------------------------

  /**
   * Parses a Razorpay webhook event.
   *
   * Razorpay webhooks have the shape:
   * ```json
   * { "entity": "event", "event": "payment.captured", "payload": { ... } }
   * ```
   */
  private parseRazorpayEvent(
    parsed: Record<string, unknown>,
    verified: boolean
  ): WebhookEvent {
    const payload = (parsed.payload ?? {}) as Record<string, unknown>
    const eventType = (parsed.event ?? 'unknown') as string

    // Extract event ID from payload.payment.entity.id or use a fallback
    let id = 'unknown'
    const paymentEntity = payload.payment as Record<string, unknown> | undefined
    if (paymentEntity) {
      const entity = paymentEntity.entity as Record<string, unknown> | undefined
      if (entity && typeof entity.id === 'string') {
        id = entity.id
      }
    }
    if (id === 'unknown' && typeof parsed.account_id === 'string') {
      id = `evt_${parsed.account_id}_${Date.now()}`
    }

    return {
      id,
      event: eventType,
      payload,
      verified,
      timestamp: new Date().toISOString(),
    }
  }

  /**
   * Parses a Cashfree webhook event.
   *
   * Cashfree webhooks have the shape:
   * ```json
   * { "type": "PAYMENT_SUCCESS_WEBHOOK", "data": { "order": {...}, "payment": {...} } }
   * ```
   */
  private parseCashfreeEvent(
    parsed: Record<string, unknown>,
    verified: boolean
  ): WebhookEvent {
    const eventType = (parsed.type ?? 'unknown') as string
    const data = (parsed.data ?? {}) as Record<string, unknown>

    // Extract payment ID from data.payment.cf_payment_id
    let id = 'unknown'
    const payment = data.payment as Record<string, unknown> | undefined
    if (payment && (typeof payment.cf_payment_id === 'string' || typeof payment.cf_payment_id === 'number')) {
      id = String(payment.cf_payment_id)
    }

    return {
      id,
      event: eventType,
      payload: data,
      verified,
      timestamp: new Date().toISOString(),
    }
  }

  /**
   * Parses a generic gateway webhook event.
   */
  private parseGenericEvent(
    parsed: Record<string, unknown>,
    verified: boolean
  ): WebhookEvent {
    return {
      id: (typeof parsed.id === 'string' ? parsed.id : 'unknown'),
      event: (typeof parsed.event === 'string' ? parsed.event : 'unknown'),
      payload: (parsed.payload ?? parsed.data ?? parsed) as Record<string, unknown>,
      verified,
      timestamp: (typeof parsed.timestamp === 'string' ? parsed.timestamp : new Date().toISOString()),
    }
  }
}
