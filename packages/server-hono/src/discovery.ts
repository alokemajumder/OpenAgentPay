import type { MiddlewareHandler, Context, Next } from 'hono';
import type { AgentPayDiscovery } from '@openagentpay/core';

/**
 * Well-known path for the agent-pay service discovery endpoint.
 */
const DISCOVERY_PATH = '/.well-known/agent-pay';

/**
 * Creates a Hono middleware that serves the `/.well-known/agent-pay`
 * service discovery document.
 *
 * Mount this at the application level (before route-specific middleware)
 * so that agents can discover payment capabilities without hitting a
 * paywalled route.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import { discoveryMiddleware } from '@openagentpay/server-hono';
 *
 * const app = new Hono();
 * app.use('*', discoveryMiddleware({
 *   version: '1.0',
 *   provider: 'My API',
 *   methods: ['x402'],
 *   currencies: ['USDC'],
 *   endpoints: [{ path: '/api/search', methods: ['GET'], pricing: { amount: '0.01', currency: 'USDC', unit: 'per_request' } }],
 *   capabilities: { subscriptions: false, streaming: false, sessions: false, receipts: true },
 * }));
 * ```
 */
export function discoveryMiddleware(config: AgentPayDiscovery): MiddlewareHandler {
  // Pre-serialise once so we don't JSON.stringify on every request.
  const body = JSON.stringify(config);

  return async (c: Context, next: Next): Promise<void | Response> => {
    const path = new URL(c.req.url).pathname;

    // Only intercept the well-known path.
    if (path !== DISCOVERY_PATH) {
      await next();
      return;
    }

    c.res = new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  };
}
