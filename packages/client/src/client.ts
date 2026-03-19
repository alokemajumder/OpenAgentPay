/**
 * @module client
 *
 * The core `withPayment()` wrapper — the primary entry point for
 * the OpenAgentPay client SDK.
 *
 * Wraps any standard `fetch` function and returns a new fetch that
 * transparently handles HTTP 402 Payment Required responses:
 *
 * 1. Makes the original request
 * 2. If the response is not 402, returns it unchanged
 * 3. If 402: parses the body, evaluates policy, executes payment,
 *    retries with proof, tracks spend, and builds a receipt
 *
 * @packageDocumentation
 */

import {
  parsePaymentRequired,
  PolicyDeniedError,
  ulid,
  type PaymentRequired,
  type PaymentMethod,
  type Pricing,
  type AgentPaymentReceipt,
} from "@openagentpay/core";

import type { ClientConfig, PaidFetch } from "./types.js";
import { SpendTracker } from "./spend-tracker.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the hostname from a URL string or Request object.
 * Falls back to the raw input if URL parsing fails.
 */
function extractDomain(input: string | URL | Request): string {
  try {
    const url =
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : input;
    return new URL(url).hostname;
  } catch {
    return String(input);
  }
}

/**
 * Extract the full URL string from a fetch input.
 */
function extractUrl(input: string | URL | Request): string {
  if (input instanceof Request) return input.url;
  if (input instanceof URL) return input.href;
  return input;
}

/**
 * Extract the HTTP method from fetch arguments.
 */
function extractMethod(
  input: string | URL | Request,
  init?: RequestInit,
): string {
  if (input instanceof Request) return input.method;
  return init?.method?.toUpperCase() ?? "GET";
}

/**
 * Match a domain against a glob pattern with simple `*` wildcard support.
 *
 * Supports patterns like:
 * - `"api.example.com"` — exact match
 * - `"*.example.com"` — matches any subdomain of example.com
 * - `"*"` — matches everything
 *
 * @param pattern - The glob pattern to match against.
 * @param domain - The domain to test.
 * @returns `true` if the domain matches the pattern.
 */
function matchGlob(pattern: string, domain: string): boolean {
  // Escape regex special chars except *, then replace * with .*
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  const regex = new RegExp(`^${escaped}$`, "i");
  return regex.test(domain);
}

/**
 * Check if a domain matches any pattern in a list.
 */
function matchesAnyGlob(
  patterns: string[],
  domain: string,
): boolean {
  return patterns.some((p) => matchGlob(p, domain));
}

/**
 * Clone a Request or build new init with an additional header.
 * Works with both Request objects and plain URL + init pairs.
 */
function addHeader(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  headerName: string,
  headerValue: string,
): [RequestInfo | URL, RequestInit | undefined] {
  if (input instanceof Request) {
    const headers = new Headers(input.headers);
    headers.set(headerName, headerValue);
    // Clone the request with new headers
    const newRequest = new Request(input, { headers });
    return [newRequest, init];
  }

  const mergedInit: RequestInit = { ...init };
  const headers = new Headers(mergedInit.headers);
  headers.set(headerName, headerValue);
  mergedInit.headers = headers;
  return [input, mergedInit];
}

// ---------------------------------------------------------------------------
// Policy Evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate all spend policy rules against the current request.
 *
 * Checks are evaluated in order of specificity. If any check fails,
 * a `PolicyDeniedError` is thrown (or `onPolicyDenied` is called
 * and then the error is thrown).
 *
 * @throws {PolicyDeniedError} If any policy rule denies the payment.
 */
function evaluatePolicy(
  config: ClientConfig,
  paymentRequired: PaymentRequired,
  domain: string,
  spendTracker: SpendTracker,
): void {
  // If an external policy engine is provided, use it instead of inline evaluation
  if (config.policyEngine) {
    const result = config.policyEngine.evaluate({
      amount: paymentRequired.pricing.amount,
      currency: paymentRequired.pricing.currency,
      domain,
    });
    if (result.outcome === "deny") {
      const reason = result.reason ?? "Denied by external policy engine";
      config.onPolicyDenied?.(reason, paymentRequired.pricing);
      throw new PolicyDeniedError(reason, "policyEngine");
    }
    return;
  }

  const policy = config.policy;
  if (!policy) return;

  const amount = parseFloat(paymentRequired.pricing.amount);
  const currency = paymentRequired.pricing.currency;

  /**
   * Helper to deny a payment with a reason and optional rule name.
   */
  function deny(reason: string, rule: string): never {
    config.onPolicyDenied?.(reason, paymentRequired.pricing);
    throw new PolicyDeniedError(reason, rule);
  }

  // --- Test mode: log but do not execute ---
  // (test mode allows the flow to continue for dry-run; checked in withPayment)

  // --- Domain allow-list ---
  if (policy.allowedDomains && policy.allowedDomains.length > 0) {
    if (!matchesAnyGlob(policy.allowedDomains, domain)) {
      deny(
        `Domain "${domain}" is not in the allowed domains list.`,
        "allowedDomains",
      );
    }
  }

  // --- Domain block-list ---
  if (policy.blockedDomains && policy.blockedDomains.length > 0) {
    if (matchesAnyGlob(policy.blockedDomains, domain)) {
      deny(
        `Domain "${domain}" is blocked by policy.`,
        "blockedDomains",
      );
    }
  }

  // --- Allowed currencies ---
  if (policy.allowedCurrencies && policy.allowedCurrencies.length > 0) {
    const upper = policy.allowedCurrencies.map((c) => c.toUpperCase());
    if (!upper.includes(currency.toUpperCase())) {
      deny(
        `Currency "${currency}" is not in the allowed currencies list (${upper.join(", ")}).`,
        "allowedCurrencies",
      );
    }
  }

  // --- Max per request ---
  if (policy.maxPerRequest !== undefined) {
    const max = parseFloat(policy.maxPerRequest);
    if (amount > max) {
      deny(
        `Request amount ${paymentRequired.pricing.amount} exceeds maxPerRequest limit of ${policy.maxPerRequest}.`,
        "maxPerRequest",
      );
    }
  }

  // --- Max per day ---
  if (policy.maxPerDay !== undefined) {
    const dailyTotal = parseFloat(spendTracker.getDailyTotal());
    const max = parseFloat(policy.maxPerDay);
    if (dailyTotal + amount > max) {
      deny(
        `Daily spend would reach ${(dailyTotal + amount).toFixed(6)} which exceeds maxPerDay limit of ${policy.maxPerDay}.`,
        "maxPerDay",
      );
    }
  }

  // --- Max per session ---
  if (policy.maxPerSession !== undefined) {
    const sessionTotal = parseFloat(spendTracker.getSessionTotal());
    const max = parseFloat(policy.maxPerSession);
    if (sessionTotal + amount > max) {
      deny(
        `Session spend would reach ${(sessionTotal + amount).toFixed(6)} which exceeds maxPerSession limit of ${policy.maxPerSession}.`,
        "maxPerSession",
      );
    }
  }

  // --- Max per provider ---
  if (policy.maxPerProvider !== undefined) {
    const providerTotal = parseFloat(spendTracker.getProviderTotal(domain));
    const max = parseFloat(policy.maxPerProvider);
    if (providerTotal + amount > max) {
      deny(
        `Provider "${domain}" spend would reach ${(providerTotal + amount).toFixed(6)} which exceeds maxPerProvider limit of ${policy.maxPerProvider}.`,
        "maxPerProvider",
      );
    }
  }

  // --- Approval threshold ---
  if (policy.approvalThreshold !== undefined) {
    const threshold = parseFloat(policy.approvalThreshold);
    if (amount >= threshold) {
      deny(
        `Request amount ${paymentRequired.pricing.amount} meets or exceeds approval threshold of ${policy.approvalThreshold}. Manual approval required.`,
        "approvalThreshold",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Payment Method Selection
// ---------------------------------------------------------------------------

/**
 * Select the first payment method supported by the wallet.
 *
 * Iterates through the methods advertised in the 402 response
 * and returns the first one the wallet adapter can handle.
 *
 * @throws {Error} If no method is supported by the wallet.
 */
function selectPaymentMethod(
  config: ClientConfig,
  methods: PaymentMethod[],
): PaymentMethod {
  for (const method of methods) {
    if (config.wallet.supports(method)) {
      return method;
    }
  }
  throw new Error(
    "No supported payment method. The wallet does not support any of the " +
      `payment methods offered: ${methods.map((m) => m.type).join(", ")}.`,
  );
}

// ---------------------------------------------------------------------------
// Receipt Builder
// ---------------------------------------------------------------------------

/**
 * Build a structured receipt from the completed payment flow.
 */
async function buildReceipt(
  requestUrl: string,
  requestMethod: string,
  domain: string,
  paymentRequired: PaymentRequired,
  selectedMethod: PaymentMethod,
  response: Response,
  startTime: number,
): Promise<AgentPaymentReceipt> {
  const latencyMs = Date.now() - startTime;

  // Read response body for hashing, then reconstruct the response
  // We cannot consume the body here as the caller needs it.
  // Use the content-length header as an approximation.
  const contentLength = parseInt(
    response.headers.get("content-length") ?? "0",
    10,
  );

  const receipt: AgentPaymentReceipt = {
    id: ulid(),
    version: "1.0",
    timestamp: new Date().toISOString(),
    payer: {
      type: "agent",
      identifier: "unknown", // Wallet doesn't expose payer identity
    },
    payee: {
      identifier: extractPayTo(selectedMethod),
      endpoint: paymentRequired.resource,
      ...(paymentRequired.meta?.provider
        ? { provider_id: paymentRequired.meta.provider }
        : {}),
    },
    request: {
      method: requestMethod,
      url: requestUrl,
    },
    payment: {
      amount: paymentRequired.pricing.amount,
      currency: paymentRequired.pricing.currency,
      method: selectedMethod.type as AgentPaymentReceipt['payment']['method'],
      status: response.ok ? "settled" : "pending",
    },
    response: {
      status_code: response.status,
      content_hash: "sha256:unknown", // Cannot hash without consuming body
      content_length: contentLength,
      latency_ms: latencyMs,
    },
  };

  return receipt;
}

/**
 * Extract the pay-to identifier from a payment method.
 */
function extractPayTo(method: PaymentMethod): string {
  switch (method.type) {
    case "x402":
      return method.pay_to;
    case "credits":
      return method.purchase_url;
    case "mpp":
      return (method as any).recipient ?? "unknown";
    case "stripe":
      return (method as any).publishable_key ?? (method as any).checkout_url ?? "unknown";
    case "paypal":
      return (method as any).checkout_url ?? (method as any).agreement_url ?? "unknown";
    case "upi":
      return (method as any).checkout_url ?? (method as any).mandate_url ?? "unknown";
    case "visa":
      return (method as any).mcp_url ?? (method as any).agentcard_url ?? "unknown";
    default:
      // Handles mock and any future method types
      return (method as any).recipient ?? (method as any).pay_to ?? "unknown";
  }
}

// ---------------------------------------------------------------------------
// withPayment()
// ---------------------------------------------------------------------------

/**
 * Wrap a standard `fetch` function with automatic 402 Payment Required handling.
 *
 * Returns a new fetch function with an identical signature. When the upstream
 * API returns HTTP 402, the wrapper:
 *
 * 1. Parses the 402 response body using `parsePaymentRequired()`
 * 2. Checks for an active subscription for the domain
 * 3. Evaluates the configured spend policy
 * 4. Selects a supported payment method
 * 5. Executes the payment via the wallet adapter
 * 6. Retries the original request with the payment proof header
 * 7. Tracks the spend and emits a receipt
 *
 * Non-402 responses pass through unchanged with zero overhead.
 *
 * @param fetchFn - The underlying fetch function to wrap (e.g. `globalThis.fetch`).
 * @param config - Client configuration including wallet, policy, and callbacks.
 * @returns A payment-aware fetch function with the same signature as `fetch`.
 *
 * @example
 * ```typescript
 * import { withPayment } from '@openagentpay/client';
 *
 * const paidFetch = withPayment(fetch, {
 *   wallet: myWalletAdapter,
 *   policy: { maxPerRequest: '1.00', maxPerDay: '50.00' },
 *   onReceipt: (r) => console.log(`Paid ${r.payment.amount} ${r.payment.currency}`),
 * });
 *
 * // Use like normal fetch — 402s are handled automatically
 * const response = await paidFetch('https://api.example.com/search?q=AI');
 * const data = await response.json();
 * ```
 */
export function withPayment(
  fetchFn: typeof globalThis.fetch,
  config: ClientConfig,
): PaidFetch {
  const spendTracker = new SpendTracker();
  const activeSubscriptions = new Map<string, string>();

  const paidFetch: PaidFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    // -----------------------------------------------------------------------
    // Step 1: Make the original request
    // -----------------------------------------------------------------------
    const response = await fetchFn(input, init);

    // -----------------------------------------------------------------------
    // Step 2: If not 402, return unchanged
    // -----------------------------------------------------------------------
    if (response.status !== 402) {
      return response;
    }

    // -----------------------------------------------------------------------
    // Step 3: Parse the 402 body
    // -----------------------------------------------------------------------
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // 402 response body is not valid JSON — return the raw response
      return response;
    }
    const paymentRequired = parsePaymentRequired(body);

    const domain = extractDomain(
      input instanceof Request ? input.url : input,
    );
    const requestUrl = extractUrl(
      input instanceof Request ? input.url : input,
    );
    const requestMethod = extractMethod(input, init);

    // -----------------------------------------------------------------------
    // Step 3b: Check for active subscription
    // -----------------------------------------------------------------------
    const subscriptionToken = activeSubscriptions.get(domain);
    if (subscriptionToken) {
      const [retryInput, retryInit] = addHeader(
        input,
        init,
        "X-SUBSCRIPTION",
        subscriptionToken,
      );
      const subResponse = await fetchFn(retryInput, retryInit);
      // If the subscription worked, return the response
      if (subResponse.status !== 402) {
        return subResponse;
      }
      // Subscription expired or invalid — fall through to payment
      activeSubscriptions.delete(domain);
    }

    // -----------------------------------------------------------------------
    // Step 3c: Test mode — log and return original 402
    // -----------------------------------------------------------------------
    if (config.policy?.testMode) {
      return response;
    }

    // -----------------------------------------------------------------------
    // Step 4: Evaluate policy
    // -----------------------------------------------------------------------
    evaluatePolicy(config, paymentRequired, domain, spendTracker);

    // -----------------------------------------------------------------------
    // Step 5: Select payment method
    // -----------------------------------------------------------------------
    const selectedMethod = selectPaymentMethod(config, paymentRequired.methods);

    // -----------------------------------------------------------------------
    // Step 6: Execute payment
    // -----------------------------------------------------------------------
    const pricing: Pricing = {
      amount: paymentRequired.pricing.amount,
      currency: paymentRequired.pricing.currency,
      description: paymentRequired.pricing.description,
    };

    const proof = await config.wallet.pay(selectedMethod, pricing);

    // -----------------------------------------------------------------------
    // Step 7: Retry with payment proof
    // -----------------------------------------------------------------------
    const startTime = Date.now();
    const [retryInput, retryInit] = addHeader(
      input,
      init,
      proof.header,
      proof.value,
    );

    let retryResponse: Response;
    const maxRetries = config.retry?.maxRetries ?? 1;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        retryResponse = await fetchFn(retryInput, retryInit);

        // -----------------------------------------------------------------------
        // Step 8: Track spend
        // -----------------------------------------------------------------------
        spendTracker.recordSpend(domain, paymentRequired.pricing.amount);

        // -----------------------------------------------------------------------
        // Step 9: Build receipt and call onReceipt
        // -----------------------------------------------------------------------
        if (config.onReceipt) {
          const receipt = await buildReceipt(
            requestUrl,
            requestMethod,
            domain,
            paymentRequired,
            selectedMethod,
            retryResponse,
            startTime,
          );
          config.onReceipt(receipt);
        }

        // -----------------------------------------------------------------------
        // Step 10: Return the response
        // -----------------------------------------------------------------------
        return retryResponse;
      } catch (err) {
        lastError = err;
        if (attempt >= maxRetries - 1) break;
      }
    }

    // All retries exhausted — re-throw the last error
    throw lastError;
  };

  return paidFetch;
}
