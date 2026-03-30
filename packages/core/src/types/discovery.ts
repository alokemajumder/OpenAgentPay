/**
 * @module discovery
 *
 * Service discovery schema for the `/.well-known/agent-pay` endpoint.
 * Provides a standardized, machine-readable mechanism that lets AI agents
 * discover the payment capabilities of an API without making a paid request.
 */

/**
 * Top-level service discovery response served at `/.well-known/agent-pay`.
 */
export interface AgentPayDiscovery {
  /** Schema version. */
  version: '1.0';
  /** Service provider name. */
  provider: string;
  /** Supported payment methods (e.g. `['x402', 'credits', 'mpp']`). */
  methods: string[];
  /** Supported currencies (e.g. `['USDC', 'USD']`). */
  currencies: string[];
  /** Pricing endpoints — maps path patterns to pricing info. */
  endpoints: DiscoveryEndpoint[];
  /** MPP-specific metadata. */
  mpp?: {
    networks: string[];
    sessions_supported: boolean;
    streaming_supported: boolean;
    challenge_url?: string;
  };
  /** Service capabilities. */
  capabilities: {
    subscriptions: boolean;
    streaming: boolean;
    sessions: boolean;
    receipts: boolean;
  };
  /** Documentation URL. */
  docs_url?: string;
  /** Terms of service URL. */
  tos_url?: string;
}

/**
 * Describes a single endpoint exposed by the service, including its
 * pricing information.
 */
export interface DiscoveryEndpoint {
  /** URL path pattern (e.g. `'/api/search'`, `'/api/*'`). */
  path: string;
  /** HTTP methods supported (e.g. `['GET', 'POST']`). */
  methods: string[];
  /** Pricing for this endpoint. */
  pricing: {
    amount: string;
    currency: string;
    unit: 'per_request' | 'per_kb' | 'per_second' | 'per_unit';
  };
  /** Human-readable description. */
  description?: string;
  /** Whether this endpoint is free. */
  free?: boolean;
}
