/**
 * @openagentpay/server-cloudflare
 *
 * Cloudflare Workers paywall middleware for OpenAgentPay.
 * Deploy payment-gated APIs at the edge with KV-backed receipt storage.
 *
 * @example
 * ```ts
 * import { createPaywallHandler } from '@openagentpay/server-cloudflare'
 * import { mock } from '@openagentpay/adapter-mock'
 *
 * const handler = createPaywallHandler(
 *   {
 *     recipient: '0x1234...',
 *     adapters: [mock()],
 *   },
 *   {
 *     route: { price: '0.01' },
 *     handler: async (request) =>
 *       new Response(JSON.stringify({ results: [] }), {
 *         headers: { 'Content-Type': 'application/json' },
 *       }),
 *   },
 * )
 *
 * export default { fetch: handler }
 * ```
 */

// Middleware
export { createPaywallHandler } from './middleware.js';
export type { WorkerFetchHandler } from './middleware.js';

// KV Receipt Store
export { KVReceiptStore } from './kv-receipt-store.js';
export type { KVReceiptStoreOptions } from './kv-receipt-store.js';

// Types
export type {
  CloudflarePaywallConfig,
  CloudflareEnv,
  CloudflareReceiptsConfig,
  WorkerPaywallOptions,
  WorkerRouteConfig,
  WorkerRouteFn,
  KVNamespaceLike,
  DurableObjectNamespaceLike,
  AnalyticsEngineLike,
  ExecutionContextLike,
  ReceiptQueryFilter,
  ReceiptQueryResult,
} from './types.js';
