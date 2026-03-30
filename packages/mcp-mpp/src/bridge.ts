/**
 * @module bridge
 *
 * The MCP-MPP Bridge connects MCP tool registration and invocation
 * with MPP payment verification.
 *
 * Tools are registered with a name, schema, handler, and pricing.
 * When a tool is called, the bridge uses the MPP adapter to verify
 * the payment credential before executing the handler, and returns
 * both the tool result and an MPP receipt.
 *
 * @example
 * ```typescript
 * import { MCPMPPBridge } from '@openagentpay/mcp-mpp';
 *
 * const bridge = new MCPMPPBridge({
 *   recipient: '0xabc...',
 *   mppConfig: { networks: ['tempo', 'stripe'] },
 *   defaultPricing: { amount: '0.01', currency: 'USD' },
 * });
 *
 * bridge.registerTool(
 *   'premium-search',
 *   { type: 'object', properties: { query: { type: 'string' } } },
 *   async (args) => ({ results: await search(args.query) }),
 *   { amount: '0.05', currency: 'USD' },
 * );
 *
 * // Handle a tool call with MPP payment
 * const result = await bridge.handleToolCall(
 *   'premium-search',
 *   { query: 'AI agents' },
 *   'MPP eyJ...',
 * );
 * ```
 *
 * @packageDocumentation
 */

import { MPPAdapter } from "@openagentpay/adapter-mpp";
import type { MPPAdapterConfig, MPPReceipt } from "@openagentpay/adapter-mpp";
import { buildPaymentRequired } from "@openagentpay/core";
import type { IncomingRequest, Pricing } from "@openagentpay/core";
import type { PaidToolConfig } from "@openagentpay/mcp";
import { paidTool } from "@openagentpay/mcp";

import type {
  MCPMPPBridgeConfig,
  PaidMCPTool,
  PaidToolDescriptor,
  PaidToolCallResult,
  ToolPricing,
  ToolInputSchema,
  ToolHandler,
} from "./types.js";

// ---------------------------------------------------------------------------
// MCPMPPBridge
// ---------------------------------------------------------------------------

/**
 * Bridge that connects MCP tools with MPP payments.
 *
 * The bridge manages a registry of paid tools and delegates payment
 * verification to the MPP adapter (Challenge-Credential-Receipt flow).
 *
 * ## Registration
 *
 * Tools are registered with `registerTool()`, which stores the tool's
 * schema, handler, and pricing. Each tool is also wrapped with the
 * MCP `paidTool()` function for protocol-level payment signaling.
 *
 * ## Invocation
 *
 * When `handleToolCall()` is called with an MPP credential, the bridge:
 * 1. Looks up the tool by name
 * 2. Issues an MPP challenge for the tool's price
 * 3. Verifies the credential against the challenge via the MPP adapter
 * 4. Executes the tool handler if verification succeeds
 * 5. Returns the result and an MPP receipt
 *
 * If no credential is provided, the bridge returns a payment requirement
 * describing how to pay for the tool.
 */
export class MCPMPPBridge {
  /** The underlying MPP adapter for payment verification. */
  readonly adapter: MPPAdapter;

  /** Registered tools indexed by name. */
  private readonly tools = new Map<string, PaidMCPTool>();

  /** Bridge configuration (exposed as readonly for discovery). */
  readonly config: Readonly<MCPMPPBridgeConfig>;

  /**
   * Creates a new MCP-MPP bridge.
   *
   * @param config - Bridge configuration including recipient, MPP settings, and default pricing
   */
  constructor(config: MCPMPPBridgeConfig) {
    this.config = config;
    this.adapter = new MPPAdapter(config.mppConfig ?? {});
  }

  // ---------------------------------------------------------------------------
  // Tool Registration
  // ---------------------------------------------------------------------------

  /**
   * Register an MCP tool with pricing for MPP payment.
   *
   * @param name - Unique tool name
   * @param inputSchema - JSON Schema describing the tool's parameters
   * @param handler - Async function that executes the tool logic
   * @param pricing - Per-invocation pricing (falls back to bridge default)
   * @param description - Optional human-readable description
   * @throws {Error} If a tool with the same name is already registered
   * @throws {Error} If no pricing is provided and no default pricing is configured
   */
  registerTool(
    name: string,
    inputSchema: ToolInputSchema,
    handler: ToolHandler,
    pricing?: ToolPricing,
    description?: string,
  ): void {
    if (this.tools.has(name)) {
      throw new Error(`Tool "${name}" is already registered.`);
    }

    const resolvedPricing = pricing ?? this.config.defaultPricing;
    if (!resolvedPricing) {
      throw new Error(
        `No pricing provided for tool "${name}" and no default pricing configured.`,
      );
    }

    const tool: PaidMCPTool = {
      name,
      description,
      inputSchema,
      handler,
      pricing: resolvedPricing,
    };

    this.tools.set(name, tool);
  }

  /**
   * Unregister a tool by name.
   *
   * @param name - The tool name to remove
   * @returns `true` if the tool was removed, `false` if it was not found
   */
  unregisterTool(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Get a registered tool by name.
   *
   * @param name - The tool name
   * @returns The registered tool, or `undefined` if not found
   */
  getTool(name: string): PaidMCPTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get the number of registered tools.
   */
  get toolCount(): number {
    return this.tools.size;
  }

  // ---------------------------------------------------------------------------
  // Tool Listing
  // ---------------------------------------------------------------------------

  /**
   * Create a list of tool descriptors with pricing metadata.
   *
   * Returns an array suitable for advertising available tools to agents,
   * including their input schemas, pricing, and accepted payment networks.
   *
   * @returns Array of tool descriptors with pricing information
   */
  createToolList(): PaidToolDescriptor[] {
    const networks = this.config.mppConfig?.networks ?? ["tempo", "stripe"];

    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      pricing: tool.pricing,
      networks,
    }));
  }

  // ---------------------------------------------------------------------------
  // Tool Invocation
  // ---------------------------------------------------------------------------

  /**
   * Handle an MCP tool call with optional MPP payment verification.
   *
   * **Without `paymentHeader`:**
   * Returns a payment requirement describing the tool's price and
   * accepted payment networks. This is equivalent to an MPP challenge.
   *
   * **With `paymentHeader`:**
   * Verifies the MPP credential, executes the tool, and returns both
   * the result and an MPP receipt.
   *
   * @param name - The tool name to invoke
   * @param args - The tool's input arguments
   * @param paymentHeader - MPP Authorization header value (e.g., `"MPP eyJ..."`)
   * @returns Result containing tool output and/or payment information
   */
  async handleToolCall(
    name: string,
    args: Record<string, unknown>,
    paymentHeader?: string,
  ): Promise<PaidToolCallResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        error: `Unknown tool: "${name}". Use createToolList() to discover available tools.`,
      };
    }

    const pricing: Pricing = {
      amount: tool.pricing.amount,
      currency: tool.pricing.currency,
      description: tool.pricing.description,
    };

    // -----------------------------------------------------------------
    // No payment provided — return payment requirement with challenge
    // -----------------------------------------------------------------
    if (!paymentHeader) {
      const method = this.adapter.describeMethod({
        recipient: this.config.recipient,
        amount: tool.pricing.amount,
        currency: tool.pricing.currency,
        resource: `mcp://tool/${name}`,
      });

      const paymentRequired = buildPaymentRequired({
        resource: `mcp://tool/${name}`,
        pricing: {
          amount: tool.pricing.amount,
          currency: tool.pricing.currency,
          unit: "per_request",
          description: tool.pricing.description,
        },
        methods: [method],
      });

      return {
        success: false,
        error: "Payment required",
        receipt: undefined,
        result: { __openagentpay: true, paymentRequired },
      };
    }

    // -----------------------------------------------------------------
    // Payment provided — verify via MPP adapter
    // -----------------------------------------------------------------
    const syntheticRequest: IncomingRequest = {
      method: "POST",
      url: `/mcp/tool/${name}`,
      headers: {
        authorization: paymentHeader,
      },
    };

    // Check that the adapter detects this as an MPP credential.
    if (!this.adapter.detect(syntheticRequest)) {
      return {
        success: false,
        error:
          "Invalid payment header format. Expected MPP credential " +
          '(e.g., "MPP eyJ...").',
      };
    }

    // Verify the credential.
    const verification = await this.adapter.verify(syntheticRequest, pricing);

    if (!verification.valid) {
      return {
        success: false,
        error: `Payment verification failed: ${verification.error ?? "unknown error"}`,
      };
    }

    // -----------------------------------------------------------------
    // Payment verified — execute the tool
    // -----------------------------------------------------------------
    let toolResult: unknown;
    try {
      toolResult = await tool.handler(args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `Tool execution failed: ${message}`,
        receipt: this.buildReceiptFromVerification(verification.receipt, tool),
      };
    }

    return {
      success: true,
      result: toolResult,
      receipt: this.buildReceiptFromVerification(verification.receipt, tool),
    };
  }

  // ---------------------------------------------------------------------------
  // MCP paidTool Integration
  // ---------------------------------------------------------------------------

  /**
   * Create an MCP `paidTool()` wrapper for a registered tool.
   *
   * This produces a handler compatible with any MCP server SDK,
   * using the bridge's MPP adapter for payment verification.
   *
   * @param name - The registered tool name
   * @returns A paidTool-wrapped handler function
   * @throws {Error} If the tool is not registered
   */
  createPaidToolHandler(name: string) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" is not registered.`);
    }

    const config: PaidToolConfig = {
      price: tool.pricing.amount,
      currency: tool.pricing.currency,
      description: tool.pricing.description,
      adapters: [this.adapter],
      recipient: this.config.recipient,
    };

    return paidTool(config, tool.handler);
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Build a receipt object from the adapter verification result.
   */
  private buildReceiptFromVerification(
    adapterReceipt: unknown,
    tool: PaidMCPTool,
  ): PaidToolCallResult["receipt"] | undefined {
    if (!adapterReceipt || typeof adapterReceipt !== "object") {
      return undefined;
    }

    const r = adapterReceipt as Record<string, unknown>;
    const payment = r.payment as Record<string, unknown> | undefined;

    return {
      receiptId: (r.id as string) ?? `mcp_mpp_${Date.now().toString(36)}`,
      challengeId: (payment?.transaction_hash as string) ?? "unknown",
      amount: tool.pricing.amount,
      currency: tool.pricing.currency,
      network: (payment?.network as string) ?? "unknown",
      transactionRef: (payment?.transaction_hash as string) ?? "unknown",
      timestamp: (r.timestamp as string) ?? new Date().toISOString(),
      status: ((payment?.status as string) ?? "settled") as "settled" | "pending",
    };
  }
}
