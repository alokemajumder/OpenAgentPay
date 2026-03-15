/**
 * @module facilitator
 *
 * Client for the x402 facilitator service.
 *
 * The facilitator is a trusted third-party service that:
 * 1. Verifies EIP-3009 transferWithAuthorization signatures
 * 2. Submits the authorization on-chain for settlement
 * 3. Returns the transaction hash and block number
 *
 * The default facilitator is hosted at https://x402.org/facilitator
 * but API providers can run their own.
 */

import {
  FacilitatorUnavailableError,
} from '@openagentpay/core'

import type { Pricing } from '@openagentpay/core'
import { FACILITATOR_HTTP_TIMEOUT_MS } from './constants.js'
import type { X402Payment, FacilitatorResponse } from './types.js'

// ---------------------------------------------------------------------------
// Facilitator Client
// ---------------------------------------------------------------------------

/**
 * Verify and settle an x402 payment via the facilitator service.
 *
 * Sends the payment authorization to the facilitator, which:
 * - Verifies the EIP-712 signature is valid
 * - Checks the sender has sufficient USDC balance and allowance
 * - Submits the transferWithAuthorization on-chain
 * - Returns the settlement transaction hash
 *
 * @param facilitatorUrl - Base URL of the facilitator service
 * @param payment        - The decoded x402 payment payload
 * @param pricing        - The pricing the payment must satisfy
 * @param timeoutMs      - HTTP request timeout in milliseconds
 * @returns The facilitator's response with verification/settlement result
 *
 * @throws {FacilitatorUnavailableError} if the facilitator cannot be reached
 */
export async function verifyWithFacilitator(
  facilitatorUrl: string,
  payment: X402Payment,
  pricing: Pricing,
  timeoutMs: number = FACILITATOR_HTTP_TIMEOUT_MS,
): Promise<FacilitatorResponse> {
  const url = facilitatorUrl.replace(/\/+$/, '') + '/verify'

  const body = JSON.stringify({
    payment: {
      scheme: payment.scheme,
      network: payment.network,
      authorization: payment.authorization,
      signature: payment.signature,
    },
    pricing: {
      amount: pricing.amount,
      currency: pricing.currency,
      description: pricing.description,
    },
  })

  let response: Response
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body,
      signal: controller.signal,
    })

    clearTimeout(timeout)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (message.includes('abort')) {
      throw new FacilitatorUnavailableError(
        `Facilitator request timed out after ${timeoutMs}ms: ${facilitatorUrl}`
      )
    }

    throw new FacilitatorUnavailableError(
      `Failed to reach facilitator at ${facilitatorUrl}: ${message}`
    )
  }

  // Parse response
  let result: FacilitatorResponse
  try {
    result = (await response.json()) as FacilitatorResponse
  } catch {
    throw new FacilitatorUnavailableError(
      `Facilitator returned invalid response (HTTP ${response.status}) from ${facilitatorUrl}`
    )
  }

  // Non-2xx status codes indicate facilitator-level errors
  if (!response.ok && !result.error) {
    throw new FacilitatorUnavailableError(
      `Facilitator returned HTTP ${response.status} from ${facilitatorUrl}`
    )
  }

  return result
}
