import { Hono } from 'hono';
import type { Context, MiddlewareHandler, Next } from 'hono';
import { createHash, randomUUID } from 'node:crypto';

import type {
  PaymentAdapter,
  Pricing,
  PaymentMethod,
  PaymentRequired,
  SubscriptionPlan,
  AgentPaymentReceipt,
  IncomingRequest,
} from '@openagentpay/core';
import {
  buildPaymentRequired,
  buildReceipt,
} from '@openagentpay/core';

import { TypedEventEmitter } from './event-emitter.js';
import type {
  PaywallConfig,
  PaywallRouteArg,
  PaywallRouteConfig,
  PaywallEvents,
  ReceiptStore,
  SubscriptionStore,
  Subscription,
} from './types.js';

// ---------------------------------------------------------------------------
// In-memory stores (used when config specifies `'memory'`)
// ---------------------------------------------------------------------------

class InMemoryReceiptStore implements ReceiptStore {
  private receipts: AgentPaymentReceipt[] = [];

  async save(receipt: AgentPaymentReceipt): Promise<void> {
    this.receipts.push(receipt);
  }

  async get(id: string): Promise<AgentPaymentReceipt | null> {
    return this.receipts.find((r) => r.id === id) ?? null;
  }

  async list(options?: { limit?: number; offset?: number }): Promise<AgentPaymentReceipt[]> {
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 100;
    return this.receipts
      .slice()
      .reverse()
      .slice(offset, offset + limit);
  }
}

class InMemorySubscriptionStore implements SubscriptionStore {
  private subs = new Map<string, Subscription>();

  async create(sub: Subscription): Promise<Subscription> {
    this.subs.set(sub.token, sub);
    return sub;
  }

  async getByToken(token: string): Promise<Subscription | null> {
    const sub = this.subs.get(token);
    if (!sub || sub.cancelled) return null;
    return sub;
  }

  async decrementCalls(token: string): Promise<{ remaining: number | 'unlimited' }> {
    const sub = this.subs.get(token);
    if (!sub) throw new Error('Subscription not found');
    if (sub.callsRemaining === 'unlimited') {
      return { remaining: 'unlimited' };
    }
    sub.callsRemaining = Math.max(0, sub.callsRemaining - 1);
    return { remaining: sub.callsRemaining };
  }

  async checkRateLimit(token: string): Promise<boolean> {
    const sub = this.subs.get(token);
    if (!sub) return false;
    if (sub.rateLimit === null || sub.rateLimit === undefined) return true;

    const now = Date.now();
    const windowStart = now - 60_000; // 1-minute sliding window
    sub.rateLimitWindow = sub.rateLimitWindow.filter((t) => t > windowStart);
    if (sub.rateLimitWindow.length >= sub.rateLimit) {
      return false; // rate limit exceeded
    }
    sub.rateLimitWindow.push(now);
    return true;
  }

  async cancel(token: string): Promise<void> {
    const sub = this.subs.get(token);
    if (sub) sub.cancelled = true;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveReceiptStore(cfg: PaywallConfig): ReceiptStore | null {
  const opt = cfg.receipts?.store;
  if (!opt) return null;
  if (opt === 'memory') return new InMemoryReceiptStore();
  return opt;
}

function resolveSubscriptionStore(cfg: PaywallConfig): SubscriptionStore | null {
  const opt = cfg.subscriptions?.store;
  if (!opt && cfg.subscriptions?.plans?.length) return new InMemorySubscriptionStore();
  if (opt === 'memory') return new InMemorySubscriptionStore();
  if (typeof opt === 'object' && opt !== null) return opt;
  return null;
}

function isPaywallRouteFn(arg: PaywallRouteArg): arg is (c: Context) => PaywallRouteConfig | Promise<PaywallRouteConfig> {
  return typeof arg === 'function';
}

interface ExtendedPricing extends Pricing {
  unit: 'per_request' | 'per_kb' | 'per_second' | 'per_unit';
}

function toPricing(route: PaywallRouteConfig): ExtendedPricing {
  return {
    amount: route.price,
    currency: route.currency ?? 'USDC',
    unit: route.unit ?? 'per_request',
    description: route.description,
  };
}

/**
 * Compute a SHA-256 hex digest.
 */
function sha256(data: string | ArrayBuffer | Uint8Array): string {
  const input = typeof data === 'string' ? data : new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer);
  return createHash('sha256').update(input as string).digest('hex');
}

/**
 * Generate a simple time-sortable unique ID (approximates ULID behaviour
 * without pulling in an external dependency).
 */
function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = randomUUID().replace(/-/g, '').slice(0, 12);
  return `${ts}-${rand}`;
}

/**
 * Convert a Hono Context into the minimal IncomingRequest interface
 * that adapters expect.
 */
function toIncomingRequest(c: Context): IncomingRequest {
  const headers: Record<string, string | undefined> = {};
  c.req.raw.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    method: c.req.method,
    url: c.req.url,
    headers,
    body: c.req.raw.body,
  };
}

// ---------------------------------------------------------------------------
// Compute period duration in milliseconds
// ---------------------------------------------------------------------------

const PERIOD_MS: Record<string, number> = {
  hour: 60 * 60 * 1_000,
  day: 24 * 60 * 60 * 1_000,
  week: 7 * 24 * 60 * 60 * 1_000,
  month: 30 * 24 * 60 * 60 * 1_000,
};

// ---------------------------------------------------------------------------
// createPaywall
// ---------------------------------------------------------------------------

export interface Paywall {
  /**
   * Route-level middleware factory.
   *
   * ```ts
   * app.get('/api/data', paywall({ price: '0.01' }), handler)
   * app.post('/api/run', paywall((c) => ({ price: computePrice(c) })), handler)
   * ```
   */
  (routeConfig: PaywallRouteArg): MiddlewareHandler;

  /** Subscribe to paywall lifecycle events. */
  on<K extends keyof PaywallEvents>(event: K, listener: (data: PaywallEvents[K]) => void): void;

  /** Unsubscribe from paywall lifecycle events. */
  off<K extends keyof PaywallEvents>(event: K, listener: (data: PaywallEvents[K]) => void): void;

  /**
   * Returns a Hono app with subscription management endpoints.
   * Only available when `subscriptions` is configured.
   */
  routes(): Hono;
}

export function createPaywall(config: PaywallConfig): Paywall {
  // Validate
  if (!config.recipient) {
    throw new Error('PaywallConfig.recipient is required');
  }
  if (!config.adapters || config.adapters.length === 0) {
    throw new Error('PaywallConfig.adapters must contain at least one adapter');
  }

  const emitter = new TypedEventEmitter<PaywallEvents>();
  const shouldEmit = config.receipts?.emit !== false;
  const receiptStore = resolveReceiptStore(config);
  const subscriptionStore = resolveSubscriptionStore(config);
  const subscriptionPlans = config.subscriptions?.plans ?? [];
  const basePath = config.subscriptions?.basePath ?? '/openagentpay';

  // -----------------------------------------------------------------------
  // Build the list of PaymentMethod descriptors from all adapters
  // -----------------------------------------------------------------------
  function getPaymentMethods(): PaymentMethod[] {
    return config.adapters.map((adapter) =>
      adapter.describeMethod({ recipient: config.recipient }),
    );
  }

  // -----------------------------------------------------------------------
  // Build a 402 JSON body
  // -----------------------------------------------------------------------
  function build402Body(pricing: ExtendedPricing, resource: string): PaymentRequired {
    return buildPaymentRequired({
      resource,
      pricing,
      methods: getPaymentMethods(),
      subscriptions: subscriptionPlans.length > 0 ? subscriptionPlans : undefined,
      meta: subscriptionPlans.length > 0
        ? {
            subscribe_url: basePath + '/subscribe',
            subscription_status_url: basePath + '/subscription',
            unsubscribe_url: basePath + '/unsubscribe',
          }
        : undefined,
    });
  }

  // -----------------------------------------------------------------------
  // Validate a subscription token from the X-SUBSCRIPTION header
  // -----------------------------------------------------------------------
  async function validateSubscription(token: string): Promise<
    | { valid: true; subscription: Subscription }
    | { valid: false; status: number; code: string; message: string }
  > {
    if (!subscriptionStore) {
      return { valid: false, status: 402, code: 'no_subscription_support', message: 'Subscriptions are not configured' };
    }

    const sub = await subscriptionStore.getByToken(token);
    if (!sub) {
      return { valid: false, status: 401, code: 'invalid_subscription', message: 'Subscription token is invalid or cancelled' };
    }

    // Check expiry
    if (new Date(sub.expiresAt).getTime() <= Date.now()) {
      return { valid: false, status: 402, code: 'subscription_expired', message: 'Subscription has expired' };
    }

    // Check call limit
    if (sub.callsRemaining !== 'unlimited' && sub.callsRemaining <= 0) {
      return { valid: false, status: 402, code: 'subscription_exhausted', message: 'Subscription call limit reached' };
    }

    // Check rate limit
    const withinRate = await subscriptionStore.checkRateLimit(token);
    if (!withinRate) {
      return { valid: false, status: 429, code: 'rate_limit_exceeded', message: 'Subscription rate limit exceeded' };
    }

    // Decrement calls
    await subscriptionStore.decrementCalls(token);

    return { valid: true, subscription: sub };
  }

  // -----------------------------------------------------------------------
  // The route-level middleware factory
  // -----------------------------------------------------------------------
  const paywall: Paywall = function paywall(routeArg: PaywallRouteArg): MiddlewareHandler {
    return async (c: Context, next: Next): Promise<void> => {
      const startTime = Date.now();

      // -----------------------------------------------------------------
      // 0. Check subscription header first
      // -----------------------------------------------------------------
      const subToken = c.req.header('x-subscription');
      if (subToken && subscriptionStore) {
        const result = await validateSubscription(subToken);
        if (result.valid) {
          // Subscription is valid — skip payment, serve directly
          await next();
          return;
        }
        // For 429 (rate limit), return immediately
        if (result.status === 429) {
          c.res = c.json(
            {
              error: result.code,
              message: result.message,
            },
            429,
          );
          return;
        }
        // For 401 (bad token), return immediately
        if (result.status === 401) {
          c.res = c.json(
            {
              error: result.code,
              message: result.message,
            },
            401,
          );
          return;
        }
        // For 402 (expired/exhausted), fall through to normal payment flow
      }

      // -----------------------------------------------------------------
      // 1. Resolve pricing
      // -----------------------------------------------------------------
      let routeConfig: PaywallRouteConfig;
      if (isPaywallRouteFn(routeArg)) {
        routeConfig = await routeArg(c);
      } else {
        routeConfig = routeArg;
      }

      const pricing = toPricing(routeConfig);
      const resource = c.req.path;
      const incomingReq = toIncomingRequest(c);

      // -----------------------------------------------------------------
      // 2. Try each adapter
      // -----------------------------------------------------------------
      for (const adapter of config.adapters) {
        const detected = adapter.detect(incomingReq);
        if (!detected) continue;

        // Adapter claims this request carries payment — verify it
        const verification = await adapter.verify(incomingReq, pricing);

        if (verification.valid) {
          // ---------------------------------------------------------------
          // Payment verified — intercept response, then emit receipt
          // ---------------------------------------------------------------

          // Call the next middleware / route handler
          await next();

          // Build receipt from the response
          if (shouldEmit || receiptStore) {
            try {
              const res = c.res;
              // Clone the response to read the body without consuming it
              const cloned = res.clone();
              const bodyBuffer = await cloned.arrayBuffer();
              const latencyMs = Date.now() - startTime;

              const receipt = buildReceipt({
                id: generateId(),
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
                  method: c.req.method,
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
                  status_code: res.status,
                  content_hash: sha256(bodyBuffer),
                  content_length: bodyBuffer.byteLength,
                  latency_ms: latencyMs,
                },
              });

              if (receiptStore) {
                await receiptStore.save(receipt);
              }

              if (shouldEmit) {
                emitter.emit('payment:received', receipt);
              }
            } catch {
              // Swallow receipt-generation errors — never break the response
            }
          }

          return; // done — request has been handled
        }

        // Verification failed — emit failure event and return 402
        if (shouldEmit) {
          emitter.emit('payment:failed', {
            code: 'payment_invalid',
            message: verification.error ?? 'Payment verification failed',
            request: {
              method: c.req.method,
              url: resource,
            },
          });
        }

        // Return 402 with error context
        c.res = c.json(
          {
            error: 'payment_invalid',
            message: verification.error ?? 'Payment verification failed',
            ...build402Body(pricing, resource),
          },
          402,
        );
        return;
      }

      // -----------------------------------------------------------------
      // 3. No adapter matched — return 402
      // -----------------------------------------------------------------
      c.res = c.json(build402Body(pricing, resource), 402);
    };
  } as Paywall;

  // -----------------------------------------------------------------------
  // Event delegation
  // -----------------------------------------------------------------------
  paywall.on = <K extends keyof PaywallEvents>(event: K, listener: (data: PaywallEvents[K]) => void) => {
    emitter.on(event, listener);
  };

  paywall.off = <K extends keyof PaywallEvents>(event: K, listener: (data: PaywallEvents[K]) => void) => {
    emitter.off(event, listener);
  };

  // -----------------------------------------------------------------------
  // Subscription routes
  // -----------------------------------------------------------------------
  paywall.routes = (): Hono => {
    const app = new Hono();

    if (!subscriptionStore || subscriptionPlans.length === 0) {
      // No subscriptions configured — return an empty app
      return app;
    }

    // POST /subscribe
    app.post(`${basePath}/subscribe`, async (c: Context) => {
      try {
        const body = await c.req.json().catch(() => ({}));
        const { plan_id, payer_identifier } = body ?? {};

        if (!plan_id || !payer_identifier) {
          return c.json(
            {
              error: 'bad_request',
              message: 'plan_id and payer_identifier are required',
            },
            400,
          );
        }

        const plan = subscriptionPlans.find((p) => p.id === plan_id);
        if (!plan) {
          return c.json(
            {
              error: 'plan_not_found',
              message: `No plan with id "${plan_id}"`,
            },
            404,
          );
        }

        const now = new Date();
        const periodMs = PERIOD_MS[plan.period] ?? PERIOD_MS.month;
        const expiresAt = new Date(now.getTime() + periodMs);
        const token = randomUUID();

        const subscription = await subscriptionStore.create({
          token,
          planId: plan.id,
          payerIdentifier: payer_identifier,
          createdAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          callsRemaining: plan.calls === 'unlimited' ? 'unlimited' : plan.calls,
          rateLimit: plan.rate_limit ?? null,
          rateLimitWindow: [],
          cancelled: false,
        });

        return c.json(
          {
            token: subscription.token,
            plan_id: subscription.planId,
            expires_at: subscription.expiresAt,
            calls_remaining: subscription.callsRemaining,
          },
          201,
        );
      } catch {
        return c.json(
          {
            error: 'internal_error',
            message: 'Failed to create subscription',
          },
          500,
        );
      }
    });

    // GET /subscription
    app.get(`${basePath}/subscription`, async (c: Context) => {
      try {
        const token = c.req.header('x-subscription');
        if (!token) {
          return c.json(
            {
              error: 'bad_request',
              message: 'X-SUBSCRIPTION header is required',
            },
            400,
          );
        }

        const sub = await subscriptionStore.getByToken(token);
        if (!sub) {
          return c.json(
            {
              error: 'not_found',
              message: 'Subscription not found or cancelled',
            },
            404,
          );
        }

        const expired = new Date(sub.expiresAt).getTime() <= Date.now();

        return c.json({
          token: sub.token,
          plan_id: sub.planId,
          payer_identifier: sub.payerIdentifier,
          created_at: sub.createdAt,
          expires_at: sub.expiresAt,
          calls_remaining: sub.callsRemaining,
          rate_limit: sub.rateLimit,
          active: !expired && !sub.cancelled,
        });
      } catch {
        return c.json(
          {
            error: 'internal_error',
            message: 'Failed to retrieve subscription',
          },
          500,
        );
      }
    });

    // POST /unsubscribe
    app.post(`${basePath}/unsubscribe`, async (c: Context) => {
      try {
        const headerToken = c.req.header('x-subscription');
        const body = await c.req.json().catch(() => ({}));
        const token = headerToken ?? body?.token;

        if (!token) {
          return c.json(
            {
              error: 'bad_request',
              message: 'X-SUBSCRIPTION header or body.token is required',
            },
            400,
          );
        }

        const sub = await subscriptionStore.getByToken(token);
        if (!sub) {
          return c.json(
            {
              error: 'not_found',
              message: 'Subscription not found or already cancelled',
            },
            404,
          );
        }

        await subscriptionStore.cancel(token);

        return c.json({
          message: 'Subscription cancelled',
          token,
        });
      } catch {
        return c.json(
          {
            error: 'internal_error',
            message: 'Failed to cancel subscription',
          },
          500,
        );
      }
    });

    return app;
  };

  return paywall;
}
