import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { AgentPayDiscovery } from '@openagentpay/core';

/**
 * Well-known path for the agent-pay service discovery endpoint.
 */
const DISCOVERY_PATH = '/.well-known/agent-pay';

/**
 * Creates an Express middleware that serves the `/.well-known/agent-pay`
 * service discovery document.
 *
 * Mount this at the application level (before route-specific middleware)
 * so that agents can discover payment capabilities without hitting a
 * paywalled route.
 *
 * @example
 * ```ts
 * import express from 'express';
 * import { discoveryMiddleware } from '@openagentpay/server-express';
 *
 * const app = express();
 * app.use(discoveryMiddleware({
 *   version: '1.0',
 *   provider: 'My API',
 *   methods: ['x402'],
 *   currencies: ['USDC'],
 *   endpoints: [{ path: '/api/search', methods: ['GET'], pricing: { amount: '0.01', currency: 'USDC', unit: 'per_request' } }],
 *   capabilities: { subscriptions: false, streaming: false, sessions: false, receipts: true },
 * }));
 * ```
 */
export function discoveryMiddleware(config: AgentPayDiscovery): RequestHandler {
  // Pre-serialise once so we don't JSON.stringify on every request.
  const body = JSON.stringify(config);

  return (req: Request, res: Response, next: NextFunction): void => {
    // Only intercept the well-known path.
    if (req.path !== DISCOVERY_PATH) {
      next();
      return;
    }

    // Only GET is allowed.
    if (req.method !== 'GET') {
      res
        .status(405)
        .set('Allow', 'GET')
        .set('Content-Type', 'application/json')
        .json({ error: 'method_not_allowed', message: 'Only GET is supported for this endpoint' });
      return;
    }

    res
      .status(200)
      .set('Content-Type', 'application/json')
      .set('Cache-Control', 'public, max-age=3600')
      .send(body);
  };
}
