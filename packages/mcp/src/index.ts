/**
 * @openagentpay/mcp
 *
 * MCP (Model Context Protocol) integration for OpenAgentPay.
 *
 * This package enables **paid MCP tools** — tools that charge per
 * invocation using the OpenAgentPay payment protocol. It provides:
 *
 * - **`paidTool()`** — Server-side wrapper that adds payment verification
 *   to any MCP tool handler. Tools return a payment requirement when
 *   called without payment, and verify proofs before executing.
 *
 * - **`withMCPPayment()`** — Client-side wrapper that intercepts tool
 *   call results, detects payment requirements, pays transparently via
 *   a wallet adapter, and retries the call with proof attached.
 *
 * The package is **framework-agnostic** — it works with any MCP server
 * or client implementation because it operates at the protocol level,
 * not at the SDK level. No MCP SDK dependency is required.
 *
 * @example Server — making a tool paid:
 * ```typescript
 * import { paidTool } from '@openagentpay/mcp';
 *
 * const handler = paidTool(
 *   { price: '0.01', adapters: [adapter], recipient: '0x...' },
 *   async (params) => ({ results: await search(params.query) })
 * );
 *
 * server.tool('premium-search', handler);
 * ```
 *
 * @example Client — handling paid tools:
 * ```typescript
 * import { withMCPPayment } from '@openagentpay/mcp';
 *
 * const client = withMCPPayment(mcpClient, {
 *   wallet: myWallet,
 *   policy: { maxPerCall: '0.10' },
 * });
 *
 * const result = await client.callTool('premium-search', { query: 'AI' });
 * ```
 *
 * @packageDocumentation
 */

// Server-side
export { paidTool } from "./paid-tool.js";

// Client-side
export { withMCPPayment } from "./mcp-client.js";
export type { MCPClientLike } from "./mcp-client.js";

// Types
export type {
  PaidToolConfig,
  ToolPaymentRequired,
  ToolPaymentProof,
  MCPPaymentConfig,
  WalletAdapter,
  ToolPaymentInfo,
} from "./types.js";
