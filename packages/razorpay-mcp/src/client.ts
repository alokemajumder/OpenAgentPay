/**
 * @module client
 *
 * Low-level client for Razorpay's MCP server.
 *
 * Communicates with the MCP server using JSON-RPC 2.0 over HTTP.
 * Auth is via HTTP Basic Authentication using the Razorpay API key
 * and secret (base64-encoded `apiKeyId:apiKeySecret`).
 *
 * @example
 * ```typescript
 * import { RazorpayMCPClient } from '@openagentpay/razorpay-mcp';
 *
 * const client = new RazorpayMCPClient({
 *   apiKeyId: 'rzp_live_...',
 *   apiKeySecret: 'secret_...',
 * });
 *
 * const tools = await client.listTools();
 * const result = await client.callTool('fetch_payment', { payment_id: 'pay_...' });
 * ```
 *
 * @packageDocumentation
 */

import type {
  RazorpayMCPConfig,
  RazorpayTool,
  RazorpayToolResult,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcErrorResponse,
} from './types.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SERVER_URL = 'https://mcp.razorpay.com/mcp'
const DEFAULT_LOCAL_PORT = 8080
const DEFAULT_TIMEOUT = 30_000

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if a JSON-RPC response is an error. */
function isJsonRpcError(
  response: JsonRpcResponse,
): response is JsonRpcErrorResponse {
  return 'error' in response
}

/**
 * Infer a tool category from its name prefix.
 *
 * Razorpay MCP tool names follow conventions like `create_payment_link`,
 * `fetch_refund`, etc. This maps common prefixes to categories.
 */
function inferCategory(
  toolName: string,
): RazorpayTool['category'] {
  if (toolName.includes('payment_link')) return 'payment_links'
  if (toolName.includes('refund')) return 'refunds'
  if (toolName.includes('order')) return 'orders'
  if (toolName.includes('qr')) return 'qr_codes'
  if (toolName.includes('settlement')) return 'settlements'
  if (toolName.includes('token')) return 'tokens'
  if (toolName.includes('payment')) return 'payments'
  return 'integration'
}

// ---------------------------------------------------------------------------
// RazorpayMCPClient
// ---------------------------------------------------------------------------

/**
 * Low-level client for the Razorpay MCP server.
 *
 * Handles JSON-RPC 2.0 communication, authentication, and error mapping.
 */
export class RazorpayMCPClient {
  private readonly authToken: string
  private readonly serverUrl: string
  private readonly timeout: number

  constructor(config: RazorpayMCPConfig) {
    if (!config.apiKeyId || !config.apiKeySecret) {
      throw new Error(
        '[RazorpayMCP] apiKeyId and apiKeySecret are required.',
      )
    }

    // Build Basic Auth token: base64(apiKeyId:apiKeySecret)
    this.authToken = btoa(`${config.apiKeyId}:${config.apiKeySecret}`)

    // Determine server URL
    if (config.useLocal) {
      const port = config.localPort ?? DEFAULT_LOCAL_PORT
      this.serverUrl = `http://localhost:${port}/mcp`
    } else {
      this.serverUrl = config.serverUrl ?? DEFAULT_SERVER_URL
    }

    this.timeout = config.timeout ?? DEFAULT_TIMEOUT
  }

  // -------------------------------------------------------------------------
  // Private: JSON-RPC transport
  // -------------------------------------------------------------------------

  /**
   * Send a JSON-RPC 2.0 request to the MCP server.
   */
  private async sendRequest(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<JsonRpcResponse> {
    const requestId = Date.now()

    const body: JsonRpcRequest = {
      jsonrpc: '2.0',
      method,
      ...(params != null ? { params } : {}),
      id: requestId,
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    let response: Response
    try {
      response = await fetch(this.serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${this.authToken}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (err: unknown) {
      clearTimeout(timeoutId)
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error(
          `[RazorpayMCP] Request timed out after ${this.timeout}ms (method: ${method}).`,
        )
      }
      throw new Error(
        `[RazorpayMCP] Network error calling ${method}: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(
        `[RazorpayMCP] HTTP ${response.status} from MCP server: ${text || response.statusText}`,
      )
    }

    const json = (await response.json()) as JsonRpcResponse
    return json
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Call a Razorpay MCP tool by name.
   *
   * @param toolName - The MCP tool name (e.g. `fetch_payment`, `create_order`).
   * @param args - Tool arguments as key-value pairs.
   * @returns A structured result with success/error status and timing.
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown> = {},
  ): Promise<RazorpayToolResult> {
    const start = Date.now()

    try {
      const response = await this.sendRequest('tools/call', {
        name: toolName,
        arguments: args,
      })

      const duration = Date.now() - start

      if (isJsonRpcError(response)) {
        return {
          tool: toolName,
          success: false,
          error: response.error.message,
          duration,
        }
      }

      // MCP tool results come back as { content: [...] } in the result field.
      // Extract meaningful data from the content array.
      const rawResult = response.result as Record<string, unknown> | undefined
      const data = this.extractToolData(rawResult)

      return {
        tool: toolName,
        success: true,
        data,
        duration,
      }
    } catch (err) {
      const duration = Date.now() - start
      return {
        tool: toolName,
        success: false,
        error:
          err instanceof Error ? err.message : String(err),
        duration,
      }
    }
  }

  /**
   * List all available tools from the Razorpay MCP server.
   *
   * @returns Array of tool descriptors with name, description, category, and input schema.
   */
  async listTools(): Promise<RazorpayTool[]> {
    const response = await this.sendRequest('tools/list')

    if (isJsonRpcError(response)) {
      throw new Error(
        `[RazorpayMCP] Failed to list tools: ${response.error.message}`,
      )
    }

    const result = response.result as { tools?: unknown[] } | undefined
    const rawTools = result?.tools ?? []

    return rawTools.map((raw) => {
      const tool = raw as Record<string, unknown>
      const name = String(tool.name ?? '')
      return {
        name,
        description: String(tool.description ?? ''),
        category: inferCategory(name),
        inputSchema: (tool.inputSchema as Record<string, unknown>) ?? {},
      }
    })
  }

  // -------------------------------------------------------------------------
  // Private: data extraction
  // -------------------------------------------------------------------------

  /**
   * Extract structured data from an MCP tool result.
   *
   * MCP results typically come as `{ content: [{ type: 'text', text: '...' }] }`.
   * The text content may be JSON-encoded.
   */
  private extractToolData(
    result: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined {
    if (!result) return undefined

    // If the result has a content array, parse text items
    if (Array.isArray(result.content)) {
      for (const item of result.content) {
        if (
          item != null &&
          typeof item === 'object' &&
          (item as Record<string, unknown>).type === 'text'
        ) {
          const text = (item as Record<string, unknown>).text
          if (typeof text === 'string') {
            try {
              const parsed = JSON.parse(text)
              if (typeof parsed === 'object' && parsed !== null) {
                return parsed as Record<string, unknown>
              }
            } catch {
              // Return as a text wrapper
              return { text }
            }
          }
        }
      }
    }

    // Return the raw result as-is if it's already structured
    return result
  }
}
