/**
 * @module mpp-session
 *
 * MPP Sessions — "OAuth for money".
 *
 * Sessions enable agents to authorize a payment budget upfront and
 * make multiple requests without per-call authorization. This is
 * essential for streaming, aggregated, and high-frequency payment flows.
 *
 * @example
 * ```typescript
 * const manager = new MPPSessionManager()
 *
 * // Agent authorizes $10 budget for 1 hour
 * const session = await manager.createSession({
 *   maxAmount: '10.00',
 *   currency: 'USD',
 *   network: 'tempo',
 *   recipient: '0xabc...',
 *   duration: '1h',
 * })
 *
 * // Each API call charges against the session
 * const { remaining } = await manager.chargeSession(session.sessionId, '0.01')
 *
 * // Close the session when done (refund remaining)
 * const { refunded } = await manager.closeSession(session.sessionId)
 * ```
 */

import type {
  MPPSession,
  MPPSessionConfig,
  MPPSessionChargeResult,
  MPPSessionCloseResult,
} from './types.js'

// ---------------------------------------------------------------------------
// Duration Parsing
// ---------------------------------------------------------------------------

/**
 * Parses a human-readable duration string into milliseconds.
 *
 * @param duration - Duration string (e.g., '1h', '24h', '30m', '7d')
 * @returns Duration in milliseconds
 */
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(m|h|d)$/)
  if (!match) {
    throw new Error(`Invalid duration format: "${duration}". Use format like "1h", "30m", "7d".`)
  }

  const value = parseInt(match[1]!, 10)
  const unit = match[2]!

  switch (unit) {
    case 'm':
      return value * 60 * 1000
    case 'h':
      return value * 60 * 60 * 1000
    case 'd':
      return value * 24 * 60 * 60 * 1000
    default:
      throw new Error(`Unknown duration unit: ${unit}`)
  }
}

// ---------------------------------------------------------------------------
// ID Generation
// ---------------------------------------------------------------------------

/**
 * Generates a unique session ID.
 */
function generateSessionId(): string {
  const timestamp = Date.now().toString(36).padStart(10, '0')
  const chars = '0123456789abcdefghjkmnpqrstvwxyz'
  let random = ''
  for (let i = 0; i < 16; i++) {
    random += chars[Math.floor(Math.random() * chars.length)]
  }
  return `mpp_sess_${timestamp}${random}`
}

// ---------------------------------------------------------------------------
// Decimal Arithmetic Helpers
// ---------------------------------------------------------------------------

/**
 * Converts a decimal string to integer micro-units (6 decimal places)
 * for safe arithmetic without floating-point errors.
 */
function toMicro(amount: string): bigint {
  const parts = amount.split('.')
  const whole = parts[0] ?? '0'
  const frac = (parts[1] ?? '').padEnd(6, '0').slice(0, 6)
  return BigInt(whole) * 1000000n + BigInt(frac)
}

/**
 * Converts micro-units back to a decimal string.
 */
function fromMicro(micro: bigint): string {
  const isNegative = micro < 0n
  const abs = isNegative ? -micro : micro
  const whole = abs / 1000000n
  const frac = (abs % 1000000n).toString().padStart(6, '0')
  // Trim trailing zeros but keep at least 2 decimal places
  const trimmed = frac.replace(/0+$/, '').padEnd(2, '0')
  const sign = isNegative ? '-' : ''
  return `${sign}${whole}.${trimmed}`
}

// ---------------------------------------------------------------------------
// MPPSessionManager
// ---------------------------------------------------------------------------

/**
 * Manages MPP payment sessions.
 *
 * Sessions provide an "authorize once, pay continuously" pattern.
 * The agent deposits or authorizes a maximum budget, and the server
 * charges against it per-request without requiring a new credential
 * each time.
 *
 * This implementation uses an in-memory store. For production use,
 * sessions should be persisted to a database.
 */
export class MPPSessionManager {
  /** In-memory session store. */
  private readonly sessions = new Map<string, MPPSession>()

  /**
   * Create a new payment session.
   *
   * The agent authorizes a maximum payment amount upfront. Subsequent
   * requests within the session can charge against this budget without
   * requiring per-call authorization.
   *
   * @param config - Session configuration
   * @returns The created MPPSession
   *
   * @example
   * ```typescript
   * const session = await manager.createSession({
   *   maxAmount: '10.00',
   *   currency: 'USD',
   *   network: 'tempo',
   *   recipient: '0xabc...',
   *   duration: '1h',
   * })
   * console.log(session.sessionId) // 'mpp_sess_...'
   * ```
   */
  async createSession(config: MPPSessionConfig): Promise<MPPSession> {
    const durationMs = parseDuration(config.duration ?? '1h')
    const expiresAt = new Date(Date.now() + durationMs).toISOString()

    const session: MPPSession = {
      sessionId: generateSessionId(),
      maxAmount: config.maxAmount,
      spent: '0.00',
      currency: config.currency,
      expiresAt,
      network: config.network,
      active: true,
    }

    this.sessions.set(session.sessionId, session)
    return session
  }

  /**
   * Charge against an active session.
   *
   * Deducts the specified amount from the session budget. Fails if
   * the session is inactive, expired, or has insufficient remaining balance.
   *
   * @param sessionId - The session to charge
   * @param amount - Amount to charge as a decimal string
   * @returns The receipt ID and remaining balance
   * @throws {Error} If the session is invalid, expired, or has insufficient funds
   *
   * @example
   * ```typescript
   * const { receipt, remaining } = await manager.chargeSession(
   *   session.sessionId,
   *   '0.01'
   * )
   * console.log(`Remaining: $${remaining}`)
   * ```
   */
  async chargeSession(sessionId: string, amount: string): Promise<MPPSessionChargeResult> {
    const session = this.sessions.get(sessionId)

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    if (!session.active) {
      throw new Error(`Session is no longer active: ${sessionId}`)
    }

    if (new Date(session.expiresAt).getTime() < Date.now()) {
      session.active = false
      throw new Error(`Session has expired: ${sessionId}`)
    }

    const maxMicro = toMicro(session.maxAmount)
    const spentMicro = toMicro(session.spent)
    const chargeMicro = toMicro(amount)
    const newSpent = spentMicro + chargeMicro

    if (newSpent > maxMicro) {
      throw new Error(
        `Insufficient session balance: charge ${amount} would exceed ` +
        `remaining ${fromMicro(maxMicro - spentMicro)} (max: ${session.maxAmount}, spent: ${session.spent})`
      )
    }

    session.spent = fromMicro(newSpent)
    const remaining = fromMicro(maxMicro - newSpent)

    // Generate a charge receipt ID
    const timestamp = Date.now().toString(36).padStart(10, '0')
    const receipt = `mpp_chrg_${timestamp}`

    return { receipt, remaining }
  }

  /**
   * Close a session and refund the remaining balance.
   *
   * Marks the session as inactive. In a production implementation,
   * this would trigger a refund of the remaining authorized amount.
   *
   * @param sessionId - The session to close
   * @returns The amount that would be refunded
   * @throws {Error} If the session is not found
   */
  async closeSession(sessionId: string): Promise<MPPSessionCloseResult> {
    const session = this.sessions.get(sessionId)

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    session.active = false

    const maxMicro = toMicro(session.maxAmount)
    const spentMicro = toMicro(session.spent)
    const refunded = fromMicro(maxMicro - spentMicro)

    return { refunded }
  }

  /**
   * Get the current status of a session.
   *
   * @param sessionId - The session to query
   * @returns The current session state
   * @throws {Error} If the session is not found
   */
  async getSessionStatus(sessionId: string): Promise<MPPSession> {
    const session = this.sessions.get(sessionId)

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    // Auto-expire if past expiry time
    if (session.active && new Date(session.expiresAt).getTime() < Date.now()) {
      session.active = false
    }

    return { ...session }
  }
}
