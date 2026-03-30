/**
 * @openagentpay/razorpay-mcp
 *
 * Razorpay MCP server integration for OpenAgentPay.
 *
 * This package bridges Razorpay's MCP (Model Context Protocol) server
 * with OpenAgentPay's payment orchestration layer. It enables AI agents
 * to use Razorpay's 48+ payment tools — payments, orders, refunds,
 * QR codes, settlements, and more — through a typed, ergonomic API.
 *
 * Three levels of abstraction are provided:
 *
 * - **{@link RazorpayMCPClient}** — Low-level JSON-RPC 2.0 client
 *   for direct MCP tool calls.
 *
 * - **{@link RazorpayPaymentTools}** — High-level typed wrappers
 *   around common Razorpay tools (payments, refunds, orders, QR codes).
 *
 * - **{@link RazorpayMCPBridge}** — Integration layer that maps
 *   OpenAgentPay concepts (paid endpoints, verification, refunds) to
 *   Razorpay MCP operations.
 *
 * @example Quick start:
 * ```typescript
 * import { createRazorpayMCP } from '@openagentpay/razorpay-mcp';
 *
 * const bridge = createRazorpayMCP({
 *   apiKeyId: 'rzp_live_...',
 *   apiKeySecret: 'secret_...',
 * });
 *
 * const endpoint = await bridge.createPaidEndpoint({
 *   amount: '500.00',
 *   currency: 'INR',
 * });
 * ```
 *
 * @packageDocumentation
 */

// Classes
export { RazorpayMCPClient } from './client.js'
export { RazorpayPaymentTools } from './payment-tools.js'
export { RazorpayMCPBridge } from './bridge.js'

// Types
export type {
  RazorpayMCPConfig,
  RazorpayTool,
  RazorpayToolResult,
  MCPReservePayOptions,
  MCPPaymentLinkResult,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcSuccessResponse,
  JsonRpcErrorResponse,
} from './types.js'

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

import type { RazorpayMCPConfig } from './types.js'
import { RazorpayMCPBridge } from './bridge.js'
import { RazorpayMCPClient } from './client.js'

/**
 * Create a Razorpay MCP bridge instance.
 *
 * The bridge provides the highest-level API, mapping OpenAgentPay
 * payment concepts to Razorpay MCP tool calls.
 *
 * @param config - Razorpay API credentials and MCP server options.
 * @returns A configured {@link RazorpayMCPBridge} instance.
 */
export function createRazorpayMCP(
  config: RazorpayMCPConfig,
): RazorpayMCPBridge {
  return new RazorpayMCPBridge(config)
}

/**
 * Create a low-level Razorpay MCP client.
 *
 * Use this when you need direct access to MCP tool calls without
 * the higher-level abstractions.
 *
 * @param config - Razorpay API credentials and MCP server options.
 * @returns A configured {@link RazorpayMCPClient} instance.
 */
export function createRazorpayMCPClient(
  config: RazorpayMCPConfig,
): RazorpayMCPClient {
  return new RazorpayMCPClient(config)
}
