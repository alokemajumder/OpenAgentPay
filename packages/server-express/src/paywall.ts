import { Router } from 'express';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
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
  PaywallRouter,
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

function isPaywallRouteFn(arg: PaywallRouteArg): arg is (req: Request) => PaywallRouteConfig | Promise<PaywallRouteConfig> {
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
function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data as string).digest('hex');
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
 * Convert an Express Request to the framework-agnostic IncomingRequest
 * expected by payment adapters.
 */
function toIncomingRequest(req: Request): IncomingRequest {
  return {
    method: req.method,
    url: req.originalUrl || req.url,
    headers: req.headers as Record<string, string | string[] | undefined>,
    body: req.body,
  };
}

/**
 * Collect the response body by monkey-patching `res.write` / `res.end`.
 * Returns a promise that resolves with { statusCode, body, latencyMs }
 * after the response has been fully sent.
 */
function interceptResponse(res: Response, startTime: number): Promise<{
  statusCode: number;
  body: Buffer;
  latencyMs: number;
}> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];

    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);

    // biome-ignore lint: we need to override the method signatures
    res.write = function (chunk: any, ...args: any[]): boolean {
      if (chunk) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
      }
      return (originalWrite as Function)(chunk, ...args);
    };

    // biome-ignore lint: we need to override the method signatures
    res.end = function (chunk?: any, ...args: any[]): Response {
      if (chunk) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
      }
      // @ts-expect-error Buffer.concat accepts Buffer[] at runtime
      const body: Buffer = Buffer.concat(chunks);
      const latencyMs = Date.now() - startTime;
      resolve({
        statusCode: res.statusCode,
        body,
        latencyMs,
      });
      return (originalEnd as Function)(chunk, ...args);
    };
  });
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
   * app.post('/api/run', paywall((req) => ({ price: computePrice(req) })), handler)
   * ```
   */
  (routeConfig: PaywallRouteArg): RequestHandler;

  /** Subscribe to paywall lifecycle events. */
  on<K extends keyof PaywallEvents>(event: K, listener: (data: PaywallEvents[K]) => void): void;

  /** Unsubscribe from paywall lifecycle events. */
  off<K extends keyof PaywallEvents>(event: K, listener: (data: PaywallEvents[K]) => void): void;

  /**
   * Returns an Express Router with subscription management endpoints.
   * Only available when `subscriptions` is configured.
   */
  routes(): Router;
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
  // Build the list of PaymentMethod descriptors from all adapters.
  // When a router is configured, it determines the ordering based on
  // cost / health / strategy so that agents see preferred methods first.
  // -----------------------------------------------------------------------
  function getPaymentMethods(pricing?: ExtendedPricing): PaymentMethod[] {
    if (config.router && pricing) {
      const ranked = config.router.rank({ amount: pricing.amount, currency: pricing.currency });
      return ranked.map((adapter) =>
        adapter.describeMethod({ recipient: config.recipient }),
      );
    }
    return config.adapters.map((adapter) =>
      adapter.describeMethod({ recipient: config.recipient }),
    );
  }

  // -----------------------------------------------------------------------
  // Build and send a 402 response
  // -----------------------------------------------------------------------
  function send402(res: Response, pricing: ExtendedPricing, resource: string, errorDetail?: string): void {
    const body: PaymentRequired = buildPaymentRequired({
      resource,
      pricing,
      methods: getPaymentMethods(pricing),
      subscriptions: subscriptionPlans.length > 0 ? subscriptionPlans : undefined,
      meta: subscriptionPlans.length > 0
        ? {
            subscribe_url: basePath + '/subscribe',
            subscription_status_url: basePath + '/subscription',
            unsubscribe_url: basePath + '/unsubscribe',
          }
        : undefined,
    });

    res.status(402).set('Content-Type', 'application/json').json(body);
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
  const paywall: Paywall = function paywall(routeArg: PaywallRouteArg): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const startTime = Date.now();

      try {
        // -----------------------------------------------------------------
        // 0. Check subscription header first
        // -----------------------------------------------------------------
        const subToken = req.headers['x-subscription'] as string | undefined;
        if (subToken && subscriptionStore) {
          const result = await validateSubscription(subToken);
          if (result.valid) {
            // Subscription is valid — skip payment, serve directly
            next();
            return;
          }
          // For 429 (rate limit), return immediately
          if (result.status === 429) {
            res
              .status(429)
              .set('Content-Type', 'application/json')
              .json({
                error: result.code,
                message: result.message,
              });
            return;
          }
          // For 401 (bad token), return immediately
          if (result.status === 401) {
            res
              .status(401)
              .set('Content-Type', 'application/json')
              .json({
                error: result.code,
                message: result.message,
              });
            return;
          }
          // For 402 (expired/exhausted), fall through to normal payment flow
        }

        // -----------------------------------------------------------------
        // 1. Resolve pricing
        // -----------------------------------------------------------------
        let routeConfig: PaywallRouteConfig;
        if (isPaywallRouteFn(routeArg)) {
          routeConfig = await routeArg(req);
        } else {
          routeConfig = routeArg;
        }

        const pricing = toPricing(routeConfig);
        const resource = req.originalUrl || req.url;

        // -----------------------------------------------------------------
        // 2. Select adapters (via router or static order)
        // -----------------------------------------------------------------
        const incomingReq = toIncomingRequest(req);
        const adaptersToTry = config.router
          ? config.router.rank({ amount: pricing.amount, currency: pricing.currency })
          : config.adapters;

        let lastVerificationError: string | undefined;
        let anyDetected = false;

        for (const adapter of adaptersToTry) {
          const detected = adapter.detect(incomingReq);
          if (!detected) continue;
          anyDetected = true;

          // Adapter claims this request carries payment — verify it
          const verifyStart = Date.now();
          let verification;
          try {
            verification = await adapter.verify(incomingReq, pricing);
          } catch (verifyError) {
            // Adapter threw (e.g., facilitator unavailable) — treat as failure, cascade to next
            const errorMsg = verifyError instanceof Error ? verifyError.message : String(verifyError);
            lastVerificationError = errorMsg;
            if (config.router) {
              config.router.recordFailure(adapter.type, { error: errorMsg });
            }
            if (shouldEmit) {
              emitter.emit('payment:failed', {
                code: 'adapter_error',
                message: errorMsg,
                request: { method: req.method, url: resource, ip: req.ip },
              });
            }
            continue; // cascade to next adapter
          }

          if (verification.valid) {
            // Record success in router health tracking
            if (config.router) {
              config.router.recordSuccess(adapter.type, { latencyMs: Date.now() - verifyStart });
            }

            // ---------------------------------------------------------------
            // Payment verified — intercept response, then emit receipt
            // ---------------------------------------------------------------
            const responseCapture = interceptResponse(res, startTime);

            // Call the next middleware / route handler
            next();

            // Fire-and-forget: build receipt after the response finishes
            if (shouldEmit || receiptStore) {
              responseCapture
                .then(async (captured) => {
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
                      method: req.method,
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
                      status_code: captured.statusCode,
                      content_hash: `sha256:${sha256(captured.body)}`,
                      content_length: captured.body.length,
                      latency_ms: captured.latencyMs,
                    },
                  });

                  if (receiptStore) {
                    await receiptStore.save(receipt);
                  }

                  if (shouldEmit) {
                    emitter.emit('payment:received', receipt);
                  }
                })
                .catch(() => {
                  // Swallow receipt-generation errors — never break the response
                });
            }

            return; // done — request is being handled
          }

          // Record failure in router health tracking
          if (config.router) {
            config.router.recordFailure(adapter.type, { error: verification.error });
          }

          // Verification failed — record error and cascade to next adapter
          lastVerificationError = verification.error ?? 'Payment verification failed';

          if (shouldEmit) {
            emitter.emit('payment:failed', {
              code: 'payment_invalid',
              message: lastVerificationError,
              request: {
                method: req.method,
                url: resource,
                ip: req.ip,
              },
            });
          }

          // Continue to next adapter (cascade) instead of returning 402 immediately
        }

        // -----------------------------------------------------------------
        // All detected adapters failed verification — return 402
        // -----------------------------------------------------------------
        if (anyDetected && lastVerificationError) {
          res
            .status(402)
            .set('Content-Type', 'application/json')
            .json({
              error: 'payment_invalid',
              message: lastVerificationError,
              ...buildPaymentRequired({
                resource,
                pricing,
                methods: getPaymentMethods(pricing),
                subscriptions: subscriptionPlans.length > 0 ? subscriptionPlans : undefined,
                meta: subscriptionPlans.length > 0
                  ? {
                      subscribe_url: basePath + '/subscribe',
                      subscription_status_url: basePath + '/subscription',
                      unsubscribe_url: basePath + '/unsubscribe',
                    }
                  : undefined,
              }),
            });
          return;
        }

        // -----------------------------------------------------------------
        // 3. No adapter matched — return 402
        // -----------------------------------------------------------------
        send402(res, pricing, resource);
      } catch (err: unknown) {
        // Unexpected error — forward to Express error handling
        next(err);
      }
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
  paywall.routes = (): Router => {
    const router = Router();

    if (!subscriptionStore || subscriptionPlans.length === 0) {
      // No subscriptions configured — return an empty router
      return router;
    }

    // POST /subscribe
    router.post(`${basePath}/subscribe`, async (req: Request, res: Response) => {
      try {
        const { plan_id, payer_identifier } = req.body ?? {};

        if (!plan_id || !payer_identifier) {
          res
            .status(400)
            .set('Content-Type', 'application/json')
            .json({
              error: 'bad_request',
              message: 'plan_id and payer_identifier are required',
            });
          return;
        }

        const plan = subscriptionPlans.find((p) => p.id === plan_id);
        if (!plan) {
          res
            .status(404)
            .set('Content-Type', 'application/json')
            .json({
              error: 'plan_not_found',
              message: `No plan with id "${plan_id}"`,
            });
          return;
        }

        // Verify payment for the subscription via configured adapters
        const incomingSubReq = toIncomingRequest(req);
        let paymentVerified = false;
        // verificationReceipt is captured for future receipt-tracking on subscriptions
        let _verificationReceipt: Partial<AgentPaymentReceipt> | undefined;

        for (const adapter of config.adapters) {
          if (adapter.detect(incomingSubReq)) {
            const subscriptionPricing = { amount: plan.amount, currency: plan.currency };
            const result = await adapter.verify(incomingSubReq, subscriptionPricing);
            if (result.valid) {
              paymentVerified = true;
              _verificationReceipt = result.receipt;
              break;
            }
          }
        }

        if (!paymentVerified) {
          res
            .status(402)
            .set('Content-Type', 'application/json')
            .json({
              error: 'payment_required',
              message: `Payment of ${plan.amount} ${plan.currency} required to subscribe to plan "${plan_id}"`,
              pricing: { amount: plan.amount, currency: plan.currency, unit: 'per_subscription' as const },
              methods: getPaymentMethods(),
            });
          return;
        }

        // Payment verified — create subscription
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

        res.status(201).set('Content-Type', 'application/json').json({
          token: subscription.token,
          plan_id: subscription.planId,
          expires_at: subscription.expiresAt,
          calls_remaining: subscription.callsRemaining,
        });
      } catch (err: unknown) {
        res
          .status(500)
          .set('Content-Type', 'application/json')
          .json({
            error: 'internal_error',
            message: 'Failed to create subscription',
          });
      }
    });

    // GET /subscription
    router.get(`${basePath}/subscription`, async (req: Request, res: Response) => {
      try {
        const token = req.headers['x-subscription'] as string | undefined;
        if (!token) {
          res
            .status(400)
            .set('Content-Type', 'application/json')
            .json({
              error: 'bad_request',
              message: 'X-SUBSCRIPTION header is required',
            });
          return;
        }

        const sub = await subscriptionStore.getByToken(token);
        if (!sub) {
          res
            .status(404)
            .set('Content-Type', 'application/json')
            .json({
              error: 'not_found',
              message: 'Subscription not found or cancelled',
            });
          return;
        }

        const expired = new Date(sub.expiresAt).getTime() <= Date.now();

        res.status(200).set('Content-Type', 'application/json').json({
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
        res
          .status(500)
          .set('Content-Type', 'application/json')
          .json({
            error: 'internal_error',
            message: 'Failed to retrieve subscription',
          });
      }
    });

    // POST /unsubscribe
    router.post(`${basePath}/unsubscribe`, async (req: Request, res: Response) => {
      try {
        const token =
          (req.headers['x-subscription'] as string | undefined) ??
          req.body?.token;

        if (!token) {
          res
            .status(400)
            .set('Content-Type', 'application/json')
            .json({
              error: 'bad_request',
              message: 'X-SUBSCRIPTION header or body.token is required',
            });
          return;
        }

        const sub = await subscriptionStore.getByToken(token);
        if (!sub) {
          res
            .status(404)
            .set('Content-Type', 'application/json')
            .json({
              error: 'not_found',
              message: 'Subscription not found or already cancelled',
            });
          return;
        }

        await subscriptionStore.cancel(token);

        res.status(200).set('Content-Type', 'application/json').json({
          message: 'Subscription cancelled',
          token,
        });
      } catch {
        res
          .status(500)
          .set('Content-Type', 'application/json')
          .json({
            error: 'internal_error',
            message: 'Failed to cancel subscription',
          });
      }
    });

    return router;
  };

  return paywall;
}
