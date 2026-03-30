/**
 * @module types
 *
 * Types for the MCP-to-MPP bridge.
 *
 * These types define how MCP tools are mapped to MPP payment flows,
 * enabling tool discovery and per-invocation charging via the Machine
 * Payments Protocol (Challenge-Credential-Receipt pattern).
 *
 * @packageDocumentation
 */

import type { MPPAdapterConfig } from "@openagentpay/adapter-mpp";

// ---------------------------------------------------------------------------
// Tool Pricing
// ---------------------------------------------------------------------------

/**
 * Pricing configuration for a single tool invocation.
 */
export interface ToolPricing {
  /** Price per invocation as a decimal string (e.g., '0.01'). */
  amount: string;

  /** Currency code or token symbol (e.g., 'USD', 'USDC'). */
  currency: string;

  /** Optional human-readable description of what this charge covers. */
  description?: string;
}

/**
 * Maps MCP tool names to their pricing configuration.
 *
 * @example
 * ```typescript
 * const pricing: MCPToolPricing = {
 *   'premium-search': { amount: '0.05', currency: 'USD' },
 *   'translate': { amount: '0.02', currency: 'USD' },
 * };
 * ```
 */
export type MCPToolPricing = Record<string, ToolPricing>;

// ---------------------------------------------------------------------------
// Tool Schema & Registration
// ---------------------------------------------------------------------------

/**
 * JSON Schema describing a tool's input parameters.
 *
 * This is the standard JSON Schema object used by MCP to describe
 * what arguments a tool accepts.
 */
export interface ToolInputSchema {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

/**
 * A tool handler function that processes arguments and returns a result.
 */
export type ToolHandler<TArgs = Record<string, unknown>, TResult = unknown> = (
  args: TArgs,
) => Promise<TResult>;

/**
 * A registered MCP tool with pricing metadata attached.
 *
 * This is the internal representation used by the bridge to track
 * tools, their schemas, handlers, and payment requirements.
 */
export interface PaidMCPTool {
  /** Tool name (must be unique within a bridge). */
  name: string;

  /** Human-readable description of the tool. */
  description?: string;

  /** JSON Schema for the tool's input parameters. */
  inputSchema: ToolInputSchema;

  /** The tool handler function. */
  handler: ToolHandler;

  /** Pricing for this tool. */
  pricing: ToolPricing;
}

// ---------------------------------------------------------------------------
// Bridge Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the MCP-MPP bridge.
 *
 * Defines the MPP adapter settings, payment recipient, default pricing,
 * and accepted payment networks.
 *
 * @example
 * ```typescript
 * const config: MCPMPPBridgeConfig = {
 *   recipient: '0xabc123...',
 *   mppConfig: {
 *     networks: ['tempo', 'stripe'],
 *     sessionsSupported: true,
 *   },
 *   defaultPricing: { amount: '0.01', currency: 'USD' },
 * };
 * ```
 */
export interface MCPMPPBridgeConfig {
  /** Recipient wallet address or account that receives payments. */
  recipient: string;

  /** Configuration for the underlying MPP adapter. */
  mppConfig?: MPPAdapterConfig;

  /**
   * Default pricing applied to tools that do not specify their own.
   * If omitted, tools without explicit pricing will be rejected
   * at registration time.
   */
  defaultPricing?: ToolPricing;

  /**
   * Human-readable name for this service (used in discovery descriptors).
   */
  serviceName?: string;

  /**
   * Base URL of this service (used in discovery descriptors).
   */
  serviceUrl?: string;
}

// ---------------------------------------------------------------------------
// Bridge Results
// ---------------------------------------------------------------------------

/**
 * Descriptor returned by `createToolList()` for each registered tool.
 *
 * Includes both the MCP tool metadata and the MPP pricing information,
 * suitable for advertising to agents.
 */
export interface PaidToolDescriptor {
  /** Tool name. */
  name: string;

  /** Human-readable description. */
  description?: string;

  /** JSON Schema for input parameters. */
  inputSchema: ToolInputSchema;

  /** Payment pricing for this tool. */
  pricing: ToolPricing;

  /** Accepted payment networks. */
  networks: string[];
}

/**
 * Result of a paid tool call via the bridge.
 *
 * Contains both the tool's output and an MPP receipt proving payment.
 */
export interface PaidToolCallResult {
  /** Whether the tool executed successfully. */
  success: boolean;

  /** The tool's return value (present when success is true). */
  result?: unknown;

  /** Error message (present when success is false). */
  error?: string;

  /** MPP receipt data (present when payment was verified). */
  receipt?: {
    receiptId: string;
    challengeId: string;
    amount: string;
    currency: string;
    network: string;
    transactionRef: string;
    timestamp: string;
    status: "settled" | "pending";
  };
}
