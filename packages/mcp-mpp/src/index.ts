/**
 * @openagentpay/mcp-mpp
 *
 * MCP-to-MPP bridge for OpenAgentPay.
 *
 * This package connects MCP (Model Context Protocol) tools with MPP
 * (Machine Payments Protocol), enabling MCP tools to be discovered
 * and paid for using the MPP Challenge-Credential-Receipt pattern.
 *
 * **Bridge** — Register MCP tools with pricing, handle tool calls
 * with MPP payment verification, and produce MCP `paidTool()` wrappers.
 *
 * **Discovery** — Generate JSON-LD catalogs and MPP service descriptors
 * for agents to discover available paid tools and their pricing.
 *
 * @example
 * ```typescript
 * import { createBridge, createDiscovery } from '@openagentpay/mcp-mpp';
 *
 * const bridge = createBridge({
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
 * const discovery = createDiscovery(bridge);
 * const catalog = discovery.describeTools();
 * const result = await bridge.handleToolCall('premium-search', { query: 'AI' }, mppHeader);
 * ```
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Class Exports
// ---------------------------------------------------------------------------

export { MCPMPPBridge } from "./bridge.js";
export { MCPPaymentDiscovery } from "./discovery.js";

// ---------------------------------------------------------------------------
// Type Exports
// ---------------------------------------------------------------------------

export type {
  MCPToolPricing,
  MCPMPPBridgeConfig,
  PaidMCPTool,
  PaidToolDescriptor,
  PaidToolCallResult,
  ToolPricing,
  ToolInputSchema,
  ToolHandler,
} from "./types.js";

export type {
  DiscoveryCatalog,
  DiscoveryToolEntry,
  MPPServiceDescriptor,
  MPPEndpointDescriptor,
} from "./discovery.js";

// ---------------------------------------------------------------------------
// Factory Imports
// ---------------------------------------------------------------------------

import { MCPMPPBridge } from "./bridge.js";
import { MCPPaymentDiscovery } from "./discovery.js";
import type { MCPMPPBridgeConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

/**
 * Create an MCP-MPP bridge.
 *
 * Convenience factory that instantiates an {@link MCPMPPBridge} with
 * the given configuration.
 *
 * @param config - Bridge configuration (recipient, MPP settings, default pricing)
 * @returns A configured bridge instance
 *
 * @example
 * ```typescript
 * const bridge = createBridge({
 *   recipient: '0xabc...',
 *   mppConfig: { networks: ['tempo'] },
 *   defaultPricing: { amount: '0.01', currency: 'USD' },
 * });
 * ```
 */
export function createBridge(config: MCPMPPBridgeConfig): MCPMPPBridge {
  return new MCPMPPBridge(config);
}

/**
 * Create a discovery instance for a bridge.
 *
 * Convenience factory that instantiates an {@link MCPPaymentDiscovery}
 * for the given bridge.
 *
 * @param bridge - The MCP-MPP bridge whose tools should be discoverable
 * @returns A configured discovery instance
 *
 * @example
 * ```typescript
 * const discovery = createDiscovery(bridge);
 * const catalog = discovery.describeTools();
 * const descriptor = discovery.toMPPServiceDescriptor();
 * ```
 */
export function createDiscovery(bridge: MCPMPPBridge): MCPPaymentDiscovery {
  return new MCPPaymentDiscovery(bridge);
}
