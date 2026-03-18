/**
 * @module types
 *
 * Types for the Visa Intelligent Commerce adapter.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the server-side Visa adapter.
 */
export interface VisaAdapterConfig {
  /** Visa MCP server URL for tokenized payment verification. */
  mcpUrl?: string;

  /** AgentCard API URL. Defaults to 'https://api.agentcard.sh'. */
  agentcardUrl?: string;

  /** Payment gateway API key for processing tokenized card charges. */
  gatewayApiKey?: string;

  /** Payment gateway URL for processing charges. */
  gatewayUrl?: string;

  /** Merchant category code. */
  mcc?: string;
}

/**
 * Configuration for the client-side Visa wallet.
 */
export interface VisaWalletConfig {
  /** Mode: 'mcp' for Visa Intelligent Commerce, 'agentcard' for AgentCard virtual cards. */
  mode: 'mcp' | 'agentcard';

  /** Visa MCP server URL (for mode: 'mcp'). */
  mcpUrl?: string;

  /** AgentCard API key (for mode: 'agentcard'). */
  agentcardApiKey?: string;

  /** AgentCard API URL (for mode: 'agentcard'). Defaults to 'https://api.agentcard.sh'. */
  agentcardUrl?: string;
}

/**
 * Configuration for the AgentCard bridge.
 */
export interface AgentCardConfig {
  /** AgentCard API key for authentication. */
  apiKey: string;

  /** AgentCard API URL. Defaults to 'https://api.agentcard.sh'. */
  apiUrl?: string;
}

// ---------------------------------------------------------------------------
// Card Details
// ---------------------------------------------------------------------------

/**
 * Details of a virtual debit card created via AgentCard.
 *
 * Note: Full PAN and CVV are only available via MCP tool calls
 * with appropriate approval gates.
 */
export interface CardDetails {
  /** Unique card identifier. */
  cardId: string;

  /** Last four digits of the card number. */
  lastFour: string;

  /** Card expiry month (01-12). */
  expiryMonth: string;

  /** Card expiry year (YYYY). */
  expiryYear: string;

  /** Card status. */
  status: 'active' | 'used' | 'closed';

  /** Amount the card was funded with. */
  fundedAmount: string;

  /** Remaining balance on the card. */
  remainingBalance: string;

  /** Currency code (e.g., 'USD'). */
  currency: string;

  /** ISO 8601 timestamp of when the card was created. */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Visa Token Types
// ---------------------------------------------------------------------------

/**
 * A Visa tokenized payment token from the X-VISA-TOKEN header.
 */
export interface VisaToken {
  /** Token type: 'mcp' for Visa MCP, 'agentcard' for AgentCard. */
  source: 'mcp' | 'agentcard';

  /** The tokenized card credential. */
  token: string;

  /** Card ID (for AgentCard tokens). */
  cardId?: string;

  /** Amount authorized by this token. */
  amount?: string;

  /** Currency. */
  currency?: string;

  /** ISO 8601 timestamp. */
  timestamp: string;
}

/**
 * Options for creating a virtual card via AgentCard.
 */
export interface CreateCardOptions {
  /** Amount to fund the card with as a decimal string (e.g., '10.00'). */
  amount: string;

  /** Currency code (e.g., 'USD'). */
  currency: string;

  /** Human-readable description of what the card is for. */
  description?: string;

  /** Additional metadata to attach to the card. */
  metadata?: Record<string, string>;
}
