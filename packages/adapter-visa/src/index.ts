/**
 * @module @openagentpay/adapter-visa
 *
 * Visa Intelligent Commerce adapter for OpenAgentPay.
 *
 * This package provides Visa-based payment support for AI agents,
 * including tokenized card credentials via Visa MCP and prepaid
 * virtual debit cards via AgentCard.
 *
 * **Server-side:** Use {@link visa} to create a {@link VisaAdapter} that
 * verifies Visa tokenized payments from the `X-VISA-TOKEN` header.
 *
 * **Client-side:** Use {@link visaWallet} to create a {@link VisaWallet}
 * that obtains payment credentials via Visa MCP or AgentCard.
 *
 * **AgentCard:** Use {@link AgentCardBridge} directly to manage virtual
 * debit cards outside of the payment flow.
 *
 * @example
 * ```typescript
 * // Server — accept Visa payments
 * import { visa } from '@openagentpay/adapter-visa'
 *
 * const adapter = visa({
 *   mcpUrl: 'https://mcp.visa.com',
 *   agentcardUrl: 'https://api.agentcard.sh',
 *   gatewayApiKey: 'gw_live_...',
 * })
 *
 * const paywall = createPaywall({
 *   adapters: [adapter],
 *   recipient: 'merchant-id',
 * })
 * ```
 *
 * @example
 * ```typescript
 * // Client — pay with AgentCard virtual debit cards
 * import { visaWallet } from '@openagentpay/adapter-visa'
 *
 * const wallet = visaWallet({
 *   mode: 'agentcard',
 *   agentcardApiKey: 'agc_live_...',
 * })
 *
 * const client = createClient({ adapters: [wallet] })
 * ```
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Class & Interface Exports
// ---------------------------------------------------------------------------

export { VisaAdapter } from './visa-adapter.js'
export { VisaWallet } from './visa-wallet.js'
export { AgentCardBridge } from './agentcard-bridge.js'
export type {
  VisaAdapterConfig,
  VisaWalletConfig,
  AgentCardConfig,
  CardDetails,
  VisaToken,
  CreateCardOptions,
} from './types.js'

// ---------------------------------------------------------------------------
// Factory Imports
// ---------------------------------------------------------------------------

import { VisaAdapter } from './visa-adapter.js'
import { VisaWallet } from './visa-wallet.js'
import type { VisaAdapterConfig, VisaWalletConfig } from './types.js'

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

/**
 * Creates a server-side Visa payment adapter.
 *
 * The Visa adapter verifies `X-VISA-TOKEN` payment headers containing
 * tokenized Visa card credentials from either the Visa MCP server or
 * AgentCard virtual debit cards.
 *
 * @param config - Visa adapter configuration
 * @param config.mcpUrl - Visa MCP server URL
 * @param config.agentcardUrl - AgentCard API URL
 * @param config.gatewayApiKey - Payment gateway API key for processing charges
 * @param config.mcc - Merchant category code
 * @returns A configured {@link VisaAdapter} instance
 *
 * @example
 * ```typescript
 * import { visa } from '@openagentpay/adapter-visa'
 *
 * const adapter = visa({
 *   mcpUrl: 'https://mcp.visa.com',
 *   gatewayApiKey: 'gw_live_...',
 *   mcc: '5734',
 * })
 * ```
 */
export function visa(config: VisaAdapterConfig = {}): VisaAdapter {
  return new VisaAdapter(config)
}

/**
 * Creates a client-side Visa wallet for making payments.
 *
 * The wallet obtains tokenized payment credentials via either Visa MCP
 * or AgentCard and returns them as `X-VISA-TOKEN` headers.
 *
 * @param config - Wallet configuration
 * @param config.mode - 'mcp' for Visa MCP, 'agentcard' for AgentCard
 * @param config.mcpUrl - Visa MCP server URL (for mode: 'mcp')
 * @param config.agentcardApiKey - AgentCard API key (for mode: 'agentcard')
 * @param config.agentcardUrl - AgentCard API URL (default: 'https://api.agentcard.sh')
 * @returns A configured {@link VisaWallet} instance
 *
 * @example
 * ```typescript
 * import { visaWallet } from '@openagentpay/adapter-visa'
 *
 * // AgentCard mode
 * const wallet = visaWallet({
 *   mode: 'agentcard',
 *   agentcardApiKey: 'agc_live_...',
 * })
 *
 * // Visa MCP mode
 * const mcpWallet = visaWallet({
 *   mode: 'mcp',
 *   mcpUrl: 'https://mcp.visa.com',
 * })
 * ```
 */
export function visaWallet(config: VisaWalletConfig): VisaWallet {
  return new VisaWallet(config)
}
