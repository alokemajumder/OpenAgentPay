/**
 * @module paid-tool
 *
 * Server-side wrapper that turns any MCP tool handler into a paid tool.
 *
 * When an MCP tool is wrapped with `paidTool()`, it behaves as follows:
 *
 * 1. **No payment attached** — returns a `ToolPaymentRequired` result
 *    containing pricing information and available payment methods.
 *    This is the MCP equivalent of an HTTP 402 Payment Required response.
 *
 * 2. **Payment proof attached** — verifies the proof via the configured
 *    adapter(s), runs the original tool handler if valid, and returns
 *    the tool's result. If verification fails, returns an error.
 *
 * This module is framework-agnostic — it works with any MCP server
 * implementation because it operates at the tool handler level, not
 * at the transport level.
 *
 * @example
 * ```typescript
 * import { paidTool } from '@openagentpay/mcp';
 * import { mockAdapter } from '@openagentpay/adapter-mock';
 *
 * const handler = paidTool(
 *   {
 *     price: '0.01',
 *     currency: 'USDC',
 *     description: 'Premium search',
 *     adapters: [mockAdapter],
 *     recipient: '0x1234...',
 *   },
 *   async (params: { query: string }) => {
 *     return { results: await deepSearch(params.query) };
 *   }
 * );
 *
 * // Register with any MCP server:
 * server.tool('premium-search', handler);
 * ```
 *
 * @packageDocumentation
 */

import {
  buildPaymentRequired,
  buildReceipt,
} from "@openagentpay/core";

import type {
  PaymentAdapter,
  IncomingRequest,
  Pricing,
} from "@openagentpay/core";

import type {
  PaidToolConfig,
  ToolPaymentRequired,
  ToolPaymentProof,
} from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check whether the given params object contains an OpenAgentPay
 * payment proof.
 */
function hasPaymentProof(
  params: unknown,
): params is ToolPaymentProof {
  if (params == null || typeof params !== "object") return false;
  const p = params as Record<string, unknown>;
  if (p.__openagentpay_payment == null || typeof p.__openagentpay_payment !== "object") return false;
  const proof = p.__openagentpay_payment as Record<string, unknown>;
  return typeof proof.header === "string" && typeof proof.value === "string";
}

/**
 * Build a synthetic IncomingRequest from the payment proof embedded
 * in MCP tool parameters. This lets us reuse the existing adapter
 * `detect()` / `verify()` methods which expect an HTTP-like request.
 */
function buildSyntheticRequest(proof: ToolPaymentProof["__openagentpay_payment"]): IncomingRequest {
  return {
    method: "POST",
    url: "/mcp/tool",
    headers: {
      [proof.header.toLowerCase()]: proof.value,
    },
  };
}

/**
 * Strip the `__openagentpay_payment` field from params before passing
 * them to the actual tool handler.
 */
function stripPaymentField<T>(params: T & Partial<ToolPaymentProof>): T {
  if (params == null || typeof params !== "object") return params;
  const { __openagentpay_payment: _, ...rest } = params as Record<string, unknown>;
  return rest as T;
}

// ---------------------------------------------------------------------------
// paidTool()
// ---------------------------------------------------------------------------

/**
 * Wrap an MCP tool handler with payment verification.
 *
 * The returned function has the same signature as the original handler,
 * but with an optional `__openagentpay_payment` field in the params.
 *
 * **Without payment proof:**
 * Returns a `ToolPaymentRequired` object containing pricing and
 * payment method information. The MCP client can detect this via
 * the `__openagentpay: true` sentinel.
 *
 * **With valid payment proof:**
 * Verifies the proof via the configured adapter(s), runs the handler,
 * and returns the tool's result.
 *
 * **With invalid payment proof:**
 * Returns an error result with payment requirement details.
 *
 * @typeParam TParams - The tool's parameter type.
 * @typeParam TResult - The tool's return type.
 * @param config - Pricing, adapters, and recipient configuration.
 * @param handler - The original tool handler function.
 * @returns A wrapped handler that enforces payment.
 */
export function paidTool<TParams, TResult>(
  config: PaidToolConfig,
  handler: (params: TParams) => Promise<TResult>,
): (params: TParams & Partial<ToolPaymentProof>) => Promise<TResult | ToolPaymentRequired> {
  // Resolve defaults.
  const currency = config.currency ?? "USDC";

  // Pre-build the pricing object.
  const pricing: Pricing = {
    amount: config.price,
    currency,
    description: config.description,
  };

  // Pre-build payment method descriptors from adapters.
  const methods = config.adapters.map((adapter) =>
    adapter.describeMethod({ recipient: config.recipient }),
  );

  return async (params) => {
    // -----------------------------------------------------------------
    // Case 1: No payment proof — return payment requirement.
    // -----------------------------------------------------------------
    if (!hasPaymentProof(params)) {
      const paymentRequired = buildPaymentRequired({
        resource: "mcp://tool",
        pricing: {
          amount: config.price,
          currency,
          unit: "per_request",
          description: config.description,
        },
        methods,
        subscriptions: config.subscriptions,
      });

      const result: ToolPaymentRequired = {
        __openagentpay: true,
        paymentRequired,
      };

      return result;
    }

    // -----------------------------------------------------------------
    // Case 2: Payment proof present — verify and execute.
    // -----------------------------------------------------------------
    const proof = params.__openagentpay_payment!;
    const syntheticRequest = buildSyntheticRequest(proof);

    // Try each adapter until one detects and verifies the payment.
    for (const adapter of config.adapters) {
      if (!adapter.detect(syntheticRequest)) continue;

      const verification = await adapter.verify(syntheticRequest, pricing);

      if (!verification.valid) {
        // Payment detected by this adapter but failed verification.
        // Return error with the payment requirement so client can retry.
        const paymentRequired = buildPaymentRequired({
          resource: "mcp://tool",
          pricing: {
            amount: config.price,
            currency,
            unit: "per_request",
            description: config.description,
          },
          methods,
        });

        const errorResult: ToolPaymentRequired = {
          __openagentpay: true,
          paymentRequired,
        };

        return errorResult;
      }

      // Payment is valid — run the actual tool handler.
      const cleanParams = stripPaymentField(params) as TParams;
      const toolResult = await handler(cleanParams);

      return toolResult;
    }

    // No adapter detected the payment format — treat as no payment.
    const paymentRequired = buildPaymentRequired({
      resource: "mcp://tool",
      pricing: {
        amount: config.price,
        currency,
        unit: "per_request",
        description: config.description,
      },
      methods,
    });

    const fallbackResult: ToolPaymentRequired = {
      __openagentpay: true,
      paymentRequired,
    };

    return fallbackResult;
  };
}
