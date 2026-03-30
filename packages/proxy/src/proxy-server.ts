/**
 * @module proxy-server
 *
 * Zero-code reverse proxy that wraps any upstream API with 402
 * payment gating. Uses Node.js built-in `http` module — no
 * external HTTP framework dependencies.
 */

import * as http from "node:http";
import type {
  PaymentAdapter,
  IncomingRequest,
  Pricing,
  PaymentMethod,
} from "@openagentpay/core";
import { buildPaymentRequired } from "@openagentpay/core";
import type { ProxyConfig, PathPricing } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default paths that bypass payment. */
const DEFAULT_FREE_PATHS = ["/", "/health", "/healthz", "/ready"];

/** Default upstream request timeout (ms). */
const DEFAULT_TIMEOUT = 30_000;

/**
 * Headers that are always stripped before forwarding to upstream.
 * These are payment-protocol headers that the upstream should not see.
 */
const PAYMENT_HEADERS = [
  "x-payment",
  "x-payment-response",
  "authorization",
  "x-mpp-credential",
  "x-mpp-session",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Match a request path against a glob-style pattern.
 *
 * Supported syntax:
 * - Exact match: `"/api/v1/chat"`
 * - Single segment wildcard: `"/api/v1/*"`
 * - Multi-segment wildcard: `"/api/**"`
 */
function matchPath(pattern: string, path: string): boolean {
  if (pattern === path) return true;

  // Convert glob to regex
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex chars (except * and ?)
    .replace(/\*\*/g, "__GLOBSTAR__")
    .replace(/\*/g, "[^/]+")
    .replace(/__GLOBSTAR__/g, ".*");

  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(path);
}

/**
 * Check if a path matches any pattern in a list.
 */
function matchesAny(patterns: string[], path: string): boolean {
  return patterns.some((p) => matchPath(p, path));
}

/**
 * Normalize incoming headers into a flat Record<string, string | undefined>.
 */
function normalizeHeaders(
  raw: http.IncomingHttpHeaders,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, val] of Object.entries(raw)) {
    out[key] = Array.isArray(val) ? val.join(", ") : val;
  }
  return out;
}

/**
 * Read the full request body as a Buffer.
 */
function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    req.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// PaymentProxy
// ---------------------------------------------------------------------------

/**
 * A zero-code reverse proxy that wraps any upstream API with 402
 * payment gating.
 *
 * Requests to gated paths are intercepted and checked for valid
 * payment proofs via the configured {@link PaymentAdapter} instances.
 * If no valid payment is found, a 402 Payment Required response is
 * returned. On successful verification the request is forwarded to
 * the upstream server.
 *
 * @example
 * ```typescript
 * import { PaymentProxy } from '@openagentpay/proxy'
 * import { mockAdapter } from '@openagentpay/core'
 *
 * const proxy = new PaymentProxy({
 *   upstream: 'https://api.example.com',
 *   pricing: { amount: '0.01', currency: 'USDC' },
 *   recipient: '0xabc...',
 *   adapters: [mockAdapter()],
 * })
 *
 * await proxy.start(8080)
 * ```
 */
export class PaymentProxy {
  private readonly upstream: URL;
  private readonly pricing: { amount: string; currency: string };
  private readonly recipient: string;
  private readonly adapters: PaymentAdapter[];
  private readonly freePaths: string[];
  private readonly allowedPaths: string[] | undefined;
  private readonly pathPricing: PathPricing[];
  private readonly stripHeaders: string[];
  private readonly timeout: number;
  private server: http.Server | null = null;

  constructor(config: ProxyConfig) {
    this.upstream = new URL(config.upstream);
    this.pricing = config.pricing;
    this.recipient = config.recipient;
    this.adapters = config.adapters ?? [];
    this.freePaths = config.freePaths ?? DEFAULT_FREE_PATHS;
    this.allowedPaths = config.allowedPaths;
    this.pathPricing = config.pathPricing ?? [];
    this.stripHeaders = (config.stripHeaders ?? []).map((h) => h.toLowerCase());
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Start the proxy server on the given port.
   *
   * @param port - TCP port to listen on
   * @param hostname - Hostname to bind to (default: `"0.0.0.0"`)
   * @returns A promise that resolves once the server is listening
   */
  start(port: number, hostname = "0.0.0.0"): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          console.error("[proxy] Unhandled error:", err);
          if (!res.headersSent) {
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Bad Gateway" }));
          }
        });
      });

      this.server.on("error", reject);
      this.server.listen(port, hostname, () => {
        console.log(
          `[proxy] Listening on ${hostname}:${port} → ${this.upstream.origin}`,
        );
        resolve();
      });
    });
  }

  /**
   * Gracefully stop the proxy server.
   */
  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((err) => {
        this.server = null;
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // -------------------------------------------------------------------------
  // Request Handling
  // -------------------------------------------------------------------------

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const path = req.url ?? "/";
    const method = req.method ?? "GET";

    // --- Free path bypass ---
    if (this.isFreePath(path)) {
      return this.forwardRequest(req, res, path, method);
    }

    // --- Check if path is gated ---
    if (!this.isGatedPath(path)) {
      return this.forwardRequest(req, res, path, method);
    }

    // --- Resolve pricing for this path ---
    const pricing = this.resolvePricing(path);

    // --- Build adapter-facing IncomingRequest ---
    const headers = normalizeHeaders(req.headers);
    const adapterReq: IncomingRequest = {
      method,
      url: path,
      headers,
    };

    // --- Try each adapter for detection + verification ---
    for (const adapter of this.adapters) {
      if (!adapter.detect(adapterReq)) continue;

      const result = await adapter.verify(adapterReq, pricing);
      if (result.valid) {
        return this.forwardRequest(req, res, path, method);
      }

      // Adapter detected payment but verification failed
      this.send402(res, path, pricing, result.error ?? "Payment verification failed");
      return;
    }

    // --- No adapter detected payment — return 402 ---
    this.send402(res, path, pricing);
  }

  // -------------------------------------------------------------------------
  // Path Matching
  // -------------------------------------------------------------------------

  private isFreePath(path: string): boolean {
    // Strip query string for matching
    const clean = path.split("?")[0];
    return matchesAny(this.freePaths, clean);
  }

  private isGatedPath(path: string): boolean {
    const clean = path.split("?")[0];
    // If allowedPaths is set, only those paths are gated
    if (this.allowedPaths) {
      return matchesAny(this.allowedPaths, clean);
    }
    // Otherwise all non-free paths are gated
    return true;
  }

  // -------------------------------------------------------------------------
  // Pricing Resolution
  // -------------------------------------------------------------------------

  private resolvePricing(path: string): Pricing {
    const clean = path.split("?")[0];
    for (const pp of this.pathPricing) {
      if (matchPath(pp.pattern, clean)) {
        return {
          amount: pp.amount,
          currency: pp.currency,
          description: pp.description,
        };
      }
    }
    return {
      amount: this.pricing.amount,
      currency: this.pricing.currency,
    };
  }

  // -------------------------------------------------------------------------
  // 402 Response
  // -------------------------------------------------------------------------

  private send402(
    res: http.ServerResponse,
    path: string,
    pricing: Pricing,
    error?: string,
  ): void {
    const methods: PaymentMethod[] = this.adapters.map((a) =>
      a.describeMethod({ recipient: this.recipient }),
    );

    const body = buildPaymentRequired({
      resource: path,
      pricing: {
        amount: pricing.amount,
        currency: pricing.currency,
        unit: "per_request",
        description:
          pricing.description ??
          (error ?? "Payment required to access this resource"),
      },
      methods,
    });

    const json = JSON.stringify(body);
    res.writeHead(402, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(json),
    });
    res.end(json);
  }

  // -------------------------------------------------------------------------
  // Upstream Forwarding
  // -------------------------------------------------------------------------

  private async forwardRequest(
    clientReq: http.IncomingMessage,
    clientRes: http.ServerResponse,
    path: string,
    method: string,
  ): Promise<void> {
    const body = await readBody(clientReq);

    // Build upstream URL
    const upstreamUrl = new URL(path, this.upstream);

    // Build headers, stripping payment headers
    const forwardHeaders: Record<string, string> = {};
    const stripped = new Set([
      ...PAYMENT_HEADERS,
      ...this.stripHeaders,
    ]);

    for (const [key, val] of Object.entries(clientReq.headers)) {
      if (stripped.has(key.toLowerCase())) continue;
      if (key.toLowerCase() === "host") continue; // will set from upstream
      if (val !== undefined) {
        forwardHeaders[key] = Array.isArray(val) ? val.join(", ") : val;
      }
    }

    // Add proxy headers
    const clientIp =
      clientReq.socket.remoteAddress ?? "unknown";
    forwardHeaders["x-forwarded-for"] = clientIp;
    forwardHeaders["x-forwarded-host"] =
      clientReq.headers.host ?? "unknown";
    forwardHeaders["x-forwarded-proto"] = "http";
    forwardHeaders["host"] = this.upstream.host;

    // Forward via fetch (available in Node 18+)
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const upstreamRes = await fetch(upstreamUrl.toString(), {
        method,
        headers: forwardHeaders,
        body: method !== "GET" && method !== "HEAD" && body.length > 0
          ? (body as unknown as BodyInit)
          : undefined,
        signal: controller.signal,
      });

      clearTimeout(timer);

      // Copy status and headers from upstream
      const responseHeaders: Record<string, string> = {};
      upstreamRes.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      clientRes.writeHead(upstreamRes.status, responseHeaders);

      // Stream the body back
      if (upstreamRes.body) {
        const reader = upstreamRes.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            clientRes.write(value);
          }
        } finally {
          reader.releaseLock();
        }
      }

      clientRes.end();
    } catch (err) {
      clearTimeout(timer);

      if ((err as Error).name === "AbortError") {
        clientRes.writeHead(504, { "Content-Type": "application/json" });
        clientRes.end(JSON.stringify({ error: "Gateway Timeout" }));
        return;
      }

      console.error("[proxy] Upstream error:", err);
      clientRes.writeHead(502, { "Content-Type": "application/json" });
      clientRes.end(
        JSON.stringify({ error: "Bad Gateway", message: (err as Error).message }),
      );
    }
  }
}
