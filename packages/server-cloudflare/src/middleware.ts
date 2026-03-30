/**
 * @module middleware
 *
 * Cloudflare Workers paywall middleware for OpenAgentPay.
 *
 * Returns a fetch-compatible handler that gates access behind payment
 * verification using web standard Request/Response (no Node.js APIs).
 */

import type {
  PaymentAdapter,
  Pricing,
  PaymentMethod,
  PaymentRequired,
  AgentPaymentReceipt,
  IncomingRequest,
} from '@openagentpay/core';
import {
  buildPaymentRequired,
  buildReceipt,
  ulid,
} from '@openagentpay/core';

import type {
  CloudflarePaywallConfig,
  CloudflareEnv,
  ExecutionContextLike,
  WorkerPaywallOptions,
  WorkerRouteConfig,
  WorkerRouteFn,
} from './types.js';
import { KVReceiptStore } from './kv-receipt-store.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256 hex digest using the Web Crypto API (available in
 * Cloudflare Workers without any Node.js polyfills).
 */
async function sha256(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  let buffer: ArrayBuffer;
  if (typeof data === 'string') {
    const encoded = new TextEncoder().encode(data);
    buffer = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;
  } else if (data instanceof Uint8Array) {
    buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  } else {
    buffer = data;
  }

  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface ExtendedPricing extends Pricing {
  unit: 'per_request' | 'per_kb' | 'per_second' | 'per_unit';
}

function toPricing(route: WorkerRouteConfig): ExtendedPricing {
  return {
    amount: route.price,
    currency: route.currency ?? 'USDC',
    unit: route.unit ?? 'per_request',
    description: route.description,
  };
}

function isRouteFn(arg: WorkerRouteConfig | WorkerRouteFn): arg is WorkerRouteFn {
  return typeof arg === 'function';
}

/**
 * Convert a web standard Request into the minimal IncomingRequest
 * interface that core adapters expect.
 */
function toIncomingRequest(request: Request): IncomingRequest {
  const headers: Record<string, string | undefined> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    method: request.method,
    url: request.url,
    headers,
    body: request.body,
  };
}

/**
 * Build a JSON Response with the given body and status code.
 */
function jsonResponse(body: unknown, status: number, extraHeaders?: Record<string, string>): Response {
  const headers = new Headers({
    'Content-Type': 'application/json',
    ...extraHeaders,
  });
  return new Response(JSON.stringify(body), { status, headers });
}

// ---------------------------------------------------------------------------
// createPaywallHandler
// ---------------------------------------------------------------------------

/**
 * Worker fetch handler type — matches the Cloudflare Workers `fetch` signature.
 */
export type WorkerFetchHandler = (
  request: Request,
  env: CloudflareEnv,
  ctx: ExecutionContextLike,
) => Promise<Response>;

/**
 * Create a Cloudflare Workers fetch handler that enforces payment
 * before forwarding requests to the upstream handler.
 *
 * The returned function has the standard CF Workers `fetch` signature:
 * `(request, env, ctx) => Promise<Response>`
 *
 * @param config - Global paywall configuration (recipient, adapters, KV bindings).
 * @param options - Per-route pricing and the upstream handler.
 * @returns A CF Workers-compatible fetch handler.
 *
 * @example
 * ```ts
 * import { createPaywallHandler } from '@openagentpay/server-cloudflare';
 * import { mock } from '@openagentpay/adapter-mock';
 *
 * const handler = createPaywallHandler(
 *   {
 *     recipient: '0x1234...',
 *     adapters: [mock()],
 *     kvNamespace: env.RECEIPT_KV,
 *   },
 *   {
 *     route: { price: '0.01' },
 *     handler: async (request) => {
 *       return new Response(JSON.stringify({ data: 'paid content' }), {
 *         headers: { 'Content-Type': 'application/json' },
 *       });
 *     },
 *   },
 * );
 *
 * export default { fetch: handler };
 * ```
 */
export function createPaywallHandler(
  config: CloudflarePaywallConfig,
  options: WorkerPaywallOptions,
): WorkerFetchHandler {
  // Validate configuration
  if (!config.recipient) {
    throw new Error('CloudflarePaywallConfig.recipient is required');
  }
  if (!config.adapters || config.adapters.length === 0) {
    throw new Error('CloudflarePaywallConfig.adapters must contain at least one adapter');
  }

  // Build the list of PaymentMethod descriptors from all adapters
  function getPaymentMethods(): PaymentMethod[] {
    return config.adapters.map((adapter) =>
      adapter.describeMethod({ recipient: config.recipient }),
    );
  }

  // Build a 402 JSON body
  function build402Body(pricing: ExtendedPricing, resource: string): PaymentRequired {
    return buildPaymentRequired({
      resource,
      pricing,
      methods: getPaymentMethods(),
    });
  }

  return async (
    request: Request,
    env: CloudflareEnv,
    ctx: ExecutionContextLike,
  ): Promise<Response> => {
    const startTime = Date.now();

    // -----------------------------------------------------------------
    // 1. Resolve pricing
    // -----------------------------------------------------------------
    let routeConfig: WorkerRouteConfig;
    if (isRouteFn(options.route)) {
      routeConfig = await options.route(request, env);
    } else {
      routeConfig = options.route;
    }

    const pricing = toPricing(routeConfig);
    const url = new URL(request.url);
    const resource = url.pathname;
    const incomingReq = toIncomingRequest(request);

    // -----------------------------------------------------------------
    // 2. Try each adapter
    // -----------------------------------------------------------------
    for (const adapter of config.adapters) {
      const detected = adapter.detect(incomingReq);
      if (!detected) continue;

      // Adapter claims this request carries payment — verify it
      const verification = await adapter.verify(incomingReq, pricing);

      if (verification.valid) {
        // -----------------------------------------------------------
        // Payment verified — call upstream handler, then build receipt
        // -----------------------------------------------------------
        const response = await options.handler(request, env, ctx);

        // Build and store receipt in the background (non-blocking)
        const shouldStore = config.kvNamespace || config.receipts?.kvNamespace;
        const shouldTrack = config.analyticsEngine;

        if (shouldStore || shouldTrack) {
          const receiptPromise = (async () => {
            try {
              const cloned = response.clone();
              const bodyBuffer = await cloned.arrayBuffer();
              const latencyMs = Date.now() - startTime;
              const contentHash = await sha256(bodyBuffer);

              const receipt = buildReceipt({
                payer: verification.receipt?.payer ?? {
                  type: 'agent',
                  identifier: 'unknown',
                },
                payee: {
                  identifier: config.recipient,
                  endpoint: resource,
                  ...verification.receipt?.payee,
                },
                request: {
                  method: request.method,
                  url: resource,
                  ...verification.receipt?.request,
                },
                payment: {
                  amount: pricing.amount,
                  currency: pricing.currency,
                  method: adapter.type as AgentPaymentReceipt['payment']['method'],
                  status: 'settled',
                  ...verification.receipt?.payment,
                },
                response: {
                  status_code: response.status,
                  content_hash: contentHash,
                  content_length: bodyBuffer.byteLength,
                  latency_ms: latencyMs,
                },
              });

              // Store in KV
              const kvNs = config.kvNamespace ?? config.receipts?.kvNamespace;
              if (kvNs) {
                const store = new KVReceiptStore({
                  kv: kvNs,
                  ttlSeconds: config.receipts?.ttlSeconds,
                });
                await store.store(receipt);
              }

              // Write to Analytics Engine
              if (config.analyticsEngine) {
                config.analyticsEngine.writeDataPoint({
                  blobs: [
                    receipt.id,
                    receipt.payer.identifier,
                    receipt.payment.method,
                    receipt.payment.currency,
                    resource,
                  ],
                  doubles: [
                    parseFloat(receipt.payment.amount),
                    latencyMs,
                    bodyBuffer.byteLength,
                  ],
                  indexes: [receipt.payment.method],
                });
              }
            } catch {
              // Swallow receipt-generation errors — never break the response
            }
          })();

          // Use waitUntil so receipt storage doesn't block the response
          ctx.waitUntil(receiptPromise);
        }

        return response;
      }

      // Verification failed — return 402 with error context
      return jsonResponse(
        {
          error: 'payment_invalid',
          message: verification.error ?? 'Payment verification failed',
          ...build402Body(pricing, resource),
        },
        402,
      );
    }

    // -----------------------------------------------------------------
    // 3. No adapter matched — return 402
    // -----------------------------------------------------------------
    return jsonResponse(build402Body(pricing, resource), 402);
  };
}
