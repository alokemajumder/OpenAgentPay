/**
 * @module types
 *
 * Types for the Razorpay MCP integration with OpenAgentPay.
 *
 * Defines configuration, tool descriptors, and result types for
 * communicating with Razorpay's MCP server (JSON-RPC 2.0 over HTTP).
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Client Configuration
// ---------------------------------------------------------------------------

/** Configuration for the Razorpay MCP client. */
export interface RazorpayMCPConfig {
  /** Razorpay API key ID (e.g., 'rzp_live_...') */
  apiKeyId: string

  /** Razorpay API key secret */
  apiKeySecret: string

  /** MCP server URL. Default: 'https://mcp.razorpay.com/mcp' */
  serverUrl?: string

  /** Whether to use local Docker instance instead of remote. Default: false */
  useLocal?: boolean

  /** Local Docker port if using local instance. Default: 8080 */
  localPort?: number

  /** Request timeout in milliseconds. Default: 30000 */
  timeout?: number
}

// ---------------------------------------------------------------------------
// Tool Descriptors
// ---------------------------------------------------------------------------

/** A Razorpay MCP tool descriptor. */
export interface RazorpayTool {
  name: string
  description: string
  category:
    | 'payments'
    | 'payment_links'
    | 'orders'
    | 'refunds'
    | 'qr_codes'
    | 'settlements'
    | 'tokens'
    | 'integration'
  inputSchema: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Tool Results
// ---------------------------------------------------------------------------

/** Result from calling a Razorpay MCP tool. */
export interface RazorpayToolResult {
  tool: string
  success: boolean
  data?: Record<string, unknown>
  error?: string
  duration: number
}

// ---------------------------------------------------------------------------
// Reserve Pay / Payment Link Types
// ---------------------------------------------------------------------------

/** UPI Reserve Pay block creation via MCP. */
export interface MCPReservePayOptions {
  /** Amount in paise. */
  amount: number
  description: string
  customerContact?: string
  customerEmail?: string
  upiLink?: boolean
  expiryMinutes?: number
}

/** Payment link result from MCP. */
export interface MCPPaymentLinkResult {
  id: string
  shortUrl: string
  amount: number
  status: string
  upiLink?: boolean
}

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 Types (internal)
// ---------------------------------------------------------------------------

/** JSON-RPC 2.0 request envelope. */
export interface JsonRpcRequest {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
  id: number
}

/** JSON-RPC 2.0 success response. */
export interface JsonRpcSuccessResponse {
  jsonrpc: '2.0'
  result: unknown
  id: number
}

/** JSON-RPC 2.0 error response. */
export interface JsonRpcErrorResponse {
  jsonrpc: '2.0'
  error: {
    code: number
    message: string
    data?: unknown
  }
  id: number
}

/** JSON-RPC 2.0 response (success or error). */
export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse
