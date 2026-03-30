/**
 * @module @openagentpay/proxy
 *
 * Zero-code reverse proxy that wraps any upstream API with 402
 * payment gating. Point it at any HTTP service and it will
 * require payment (verified via PaymentAdapter) before forwarding
 * requests.
 *
 * **Usage:**
 *
 * @example
 * ```typescript
 * import { createProxy } from '@openagentpay/proxy'
 *
 * const proxy = createProxy({
 *   upstream: 'https://api.example.com',
 *   pricing: { amount: '0.01', currency: 'USDC' },
 *   recipient: '0xabc...',
 * })
 *
 * await proxy.start(8080)
 * ```
 *
 * @example
 * ```typescript
 * // With per-path pricing and free health checks
 * import { createProxy } from '@openagentpay/proxy'
 * import { mockAdapter } from '@openagentpay/core'
 *
 * const proxy = createProxy({
 *   upstream: 'http://localhost:3000',
 *   pricing: { amount: '0.001', currency: 'USDC' },
 *   recipient: '0xabc...',
 *   adapters: [mockAdapter()],
 *   freePaths: ['/', '/health', '/docs/**'],
 *   pathPricing: [
 *     { pattern: '/api/v1/expensive/**', amount: '0.10', currency: 'USDC' },
 *     { pattern: '/api/v1/cheap/**', amount: '0.001', currency: 'USDC' },
 *   ],
 * })
 *
 * await proxy.start(8080)
 * ```
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Class & Type Exports
// ---------------------------------------------------------------------------

export { PaymentProxy } from "./proxy-server.js";
export type { ProxyConfig, PathPricing } from "./types.js";

// ---------------------------------------------------------------------------
// Factory Import
// ---------------------------------------------------------------------------

import { PaymentProxy } from "./proxy-server.js";
import type { ProxyConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Factory Function
// ---------------------------------------------------------------------------

/**
 * Create a new payment-gating reverse proxy.
 *
 * This is the primary entry point. The returned {@link PaymentProxy}
 * instance can be started on any port and will intercept requests,
 * verify payment via the configured adapters, and forward paid
 * requests to the upstream URL.
 *
 * @param config - Proxy configuration
 * @param config.upstream - Upstream base URL to forward to
 * @param config.pricing - Default pricing for gated paths
 * @param config.recipient - Recipient wallet address
 * @param config.adapters - Payment adapters for verification
 * @param config.freePaths - Paths that bypass payment
 * @param config.allowedPaths - Paths that require payment (if set, only these are gated)
 * @param config.pathPricing - Per-path pricing overrides
 * @returns A configured {@link PaymentProxy} instance
 */
export function createProxy(config: ProxyConfig): PaymentProxy {
  return new PaymentProxy(config);
}
