/**
 * @module mcp-client
 *
 * Client-side wrapper that adds transparent payment handling to any
 * MCP client's `callTool` method.
 *
 * When an MCP tool returns a `ToolPaymentRequired` result, the wrapper:
 * 1. Parses the payment requirement from the result
 * 2. Evaluates the spend policy (maxPerCall, maxPerDay, allowedTools)
 * 3. Selects a compatible payment method and pays via the wallet
 * 4. Retries the tool call with the payment proof attached
 * 5. Builds a receipt and calls the `onReceipt` callback
 *
 * This module is framework-agnostic — it works with any MCP client
 * that exposes a `callTool(name, params)` method, regardless of the
 * underlying MCP SDK or transport.
 *
 * @example
 * ```typescript
 * import { withMCPPayment } from '@openagentpay/mcp';
 * import { mockWallet } from '@openagentpay/adapter-mock';
 *
 * const paidClient = withMCPPayment(mcpClient, {
 *   wallet: mockWallet(),
 *   policy: { maxPerCall: '0.10', maxPerDay: '5.00' },
 *   onReceipt: (receipt) => console.log('Paid:', receipt.payment.amount),
 * });
 *
 * // If 'premium-search' is a paid tool, payment happens transparently:
 * const result = await paidClient.callTool('premium-search', { query: 'AI' });
 * ```
 *
 * @packageDocumentation
 */

import { buildReceipt } from "@openagentpay/core";
import type { PaymentRequired, AgentPaymentReceipt } from "@openagentpay/core";

import type {
  MCPPaymentConfig,
  ToolPaymentRequired,
  ToolPaymentProof,
} from "./types.js";

// ---------------------------------------------------------------------------
// Spend Tracking
// ---------------------------------------------------------------------------

/**
 * Internal spend tracker for enforcing daily spend limits.
 *
 * Tracks payments within a rolling 24-hour window. Old entries
 * are pruned on each check to keep memory bounded.
 */
interface SpendEntry {
  amount: number;
  timestamp: number;
}

class SpendTracker {
  private entries: SpendEntry[] = [];

  /** Record a payment. */
  record(amount: number): void {
    this.entries.push({ amount, timestamp: Date.now() });
  }

  /** Get total spend in the last 24 hours. */
  getDailyTotal(): number {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    this.entries = this.entries.filter((e) => e.timestamp > cutoff);
    return this.entries.reduce((sum, e) => sum + e.amount, 0);
  }
}

// ---------------------------------------------------------------------------
// Result Detection
// ---------------------------------------------------------------------------

/**
 * Check whether a tool call result is a `ToolPaymentRequired` response.
 *
 * Handles both direct result objects and MCP-style result wrappers
 * that contain a `content` array with text items.
 */
function extractPaymentRequired(result: unknown): PaymentRequired | null {
  if (result == null || typeof result !== "object") return null;

  const obj = result as Record<string, unknown>;

  // Direct ToolPaymentRequired object.
  if (obj.__openagentpay === true && obj.paymentRequired != null) {
    return obj.paymentRequired as PaymentRequired;
  }

  // MCP-style result: { content: [{ type: 'text', text: '...' }] }
  // The payment requirement may be JSON-serialized inside a text content item.
  if (Array.isArray(obj.content)) {
    for (const item of obj.content) {
      if (item != null && typeof item === "object" && (item as Record<string, unknown>).type === "text") {
        const text = (item as Record<string, unknown>).text;
        if (typeof text === "string") {
          try {
            const parsed = JSON.parse(text) as Record<string, unknown>;
            if (parsed.__openagentpay === true && parsed.paymentRequired != null) {
              return parsed.paymentRequired as PaymentRequired;
            }
          } catch {
            // Not JSON — skip.
          }
        }
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Policy Evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate whether a payment is allowed under the configured policy.
 *
 * @returns `null` if allowed, or an error message string if denied.
 */
function evaluatePolicy(
  toolName: string,
  amount: string,
  policy: MCPPaymentConfig["policy"],
  dailyTotal: number,
): string | null {
  if (!policy) return null;

  const amountNum = parseFloat(amount);

  // Check tool allowlist.
  if (policy.allowedTools && policy.allowedTools.length > 0) {
    if (!policy.allowedTools.includes(toolName)) {
      return `Tool "${toolName}" is not in the allowed tools list.`;
    }
  }

  // Check per-call limit.
  if (policy.maxPerCall != null) {
    const max = parseFloat(policy.maxPerCall);
    if (amountNum > max) {
      return `Amount ${amount} exceeds maxPerCall limit of ${policy.maxPerCall}.`;
    }
  }

  // Check daily limit.
  if (policy.maxPerDay != null) {
    const max = parseFloat(policy.maxPerDay);
    if (dailyTotal + amountNum > max) {
      return `Payment of ${amount} would exceed maxPerDay limit of ${policy.maxPerDay} (current daily total: ${dailyTotal.toFixed(6)}).`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// withMCPPayment()
// ---------------------------------------------------------------------------

/**
 * Minimal MCP client interface.
 *
 * Any object with a `callTool` method can be wrapped. This keeps the
 * wrapper decoupled from any specific MCP SDK.
 */
export interface MCPClientLike {
  callTool(name: string, params?: Record<string, unknown>): Promise<unknown>;
}

/**
 * Wrap an MCP client to handle paid tools transparently.
 *
 * Returns a proxied version of the client where the `callTool` method
 * is intercepted. When a tool returns a payment requirement, the
 * wrapper automatically pays and retries.
 *
 * All other methods and properties of the client are passed through
 * unchanged.
 *
 * @typeParam TClient - The MCP client type (must have `callTool`).
 * @param client - The MCP client instance to wrap.
 * @param config - Payment wallet, policy, and callback configuration.
 * @returns A proxied client with transparent payment handling.
 */
export function withMCPPayment<TClient extends MCPClientLike>(
  client: TClient,
  config: MCPPaymentConfig,
): TClient {
  const tracker = new SpendTracker();

  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop !== "callTool") {
        return Reflect.get(target, prop, receiver);
      }

      // Return a wrapped callTool function.
      return async (name: string, params?: Record<string, unknown>): Promise<unknown> => {
        // Step 1: Call the original tool.
        const result = await target.callTool(name, params);

        // Step 2: Check for payment requirement.
        const paymentRequired = extractPaymentRequired(result);
        if (!paymentRequired) {
          // Not a paid tool (or already paid) — return as-is.
          return result;
        }

        // Step 3: Evaluate spend policy.
        const amount = paymentRequired.pricing.amount;
        const currency = paymentRequired.pricing.currency;
        const dailyTotal = tracker.getDailyTotal();

        const policyDenial = evaluatePolicy(name, amount, config.policy, dailyTotal);
        if (policyDenial) {
          throw new Error(`[OpenAgentPay] Policy denied payment for tool "${name}": ${policyDenial}`);
        }

        // Step 4: Find a compatible payment method and pay.
        let paymentProof: { header: string; value: string } | null = null;
        let usedMethodType: string | null = null;

        for (const method of paymentRequired.methods) {
          if (config.wallet.supports(method)) {
            const proof = await config.wallet.pay(method, {
              amount,
              currency,
              description: paymentRequired.pricing.description,
            });
            paymentProof = { header: proof.header, value: proof.value };
            usedMethodType = method.type;
            break;
          }
        }

        if (!paymentProof || !usedMethodType) {
          throw new Error(
            `[OpenAgentPay] No compatible payment method found for tool "${name}". ` +
            `Available methods: ${paymentRequired.methods.map((m) => m.type).join(", ")}`,
          );
        }

        // Step 5: Retry with payment proof attached.
        const retryParams: Record<string, unknown> = {
          ...(params ?? {}),
          __openagentpay_payment: paymentProof,
        };

        const paidResult = await target.callTool(name, retryParams);

        // Step 6: Track the spend.
        tracker.record(parseFloat(amount));

        // Step 7: Build receipt and notify.
        if (config.onReceipt) {
          const receipt: AgentPaymentReceipt = buildReceipt({
            payer: {
              type: "agent",
              identifier: "mcp-agent",
            },
            payee: {
              identifier: paymentRequired.resource,
              endpoint: `mcp://tool/${name}`,
            },
            request: {
              method: "MCP",
              url: `mcp://tool/${name}`,
              tool_name: name,
            },
            payment: {
              amount,
              currency,
              method: usedMethodType as "x402" | "credits" | "mock",
              status: "settled",
            },
            response: {
              status_code: 200,
              content_hash: "",
              content_length: 0,
              latency_ms: 0,
            },
          });

          config.onReceipt(receipt);
        }

        // Step 8: Check if the retry also returned a payment requirement
        // (e.g., if verification failed). If so, throw rather than loop.
        const retryPaymentRequired = extractPaymentRequired(paidResult);
        if (retryPaymentRequired) {
          throw new Error(
            `[OpenAgentPay] Payment verification failed for tool "${name}". ` +
            `The server rejected the payment proof.`,
          );
        }

        return paidResult;
      };
    },
  });
}
