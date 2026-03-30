/**
 * @module discovery
 *
 * Payment-aware tool discovery for MCP tools exposed via MPP.
 *
 * The `MCPPaymentDiscovery` class produces machine-readable catalogs
 * of available paid tools, including pricing, accepted networks, and
 * tool schemas. These catalogs can be served as JSON or JSON-LD
 * endpoints for agents to discover what tools are available and how
 * to pay for them.
 *
 * @example
 * ```typescript
 * import { createBridge, createDiscovery } from '@openagentpay/mcp-mpp';
 *
 * const bridge = createBridge({
 *   recipient: '0xabc...',
 *   mppConfig: { networks: ['tempo', 'stripe'] },
 * });
 *
 * bridge.registerTool('search', schema, handler, pricing);
 *
 * const discovery = createDiscovery(bridge);
 * const catalog = discovery.describeTools();
 * const descriptor = discovery.toMPPServiceDescriptor();
 * ```
 *
 * @packageDocumentation
 */

import type { MCPMPPBridge } from "./bridge.js";
import type { PaidToolDescriptor } from "./types.js";

// ---------------------------------------------------------------------------
// Discovery Catalog Types
// ---------------------------------------------------------------------------

/**
 * A tool entry in the discovery catalog.
 */
export interface DiscoveryToolEntry {
  /** Tool name. */
  name: string;

  /** Human-readable description. */
  description?: string;

  /** JSON Schema for input parameters. */
  inputSchema: Record<string, unknown>;

  /** Pricing for this tool. */
  pricing: {
    amount: string;
    currency: string;
    unit: "per_request";
    description?: string;
  };

  /** Accepted payment networks. */
  acceptedNetworks: string[];
}

/**
 * The full discovery catalog — a JSON (or JSON-LD) document
 * listing all available paid tools with their pricing.
 */
export interface DiscoveryCatalog {
  /** JSON-LD context for semantic interoperability. */
  "@context"?: string;

  /** Document type. */
  "@type"?: string;

  /** Service name. */
  name: string;

  /** Service description. */
  description: string;

  /** Service URL. */
  url?: string;

  /** Protocol identifier. */
  protocol: "mpp";

  /** Protocol version. */
  protocolVersion: "1.0";

  /** Accepted payment networks for the service. */
  acceptedNetworks: string[];

  /** Recipient address. */
  recipient: string;

  /** Available tools. */
  tools: DiscoveryToolEntry[];

  /** ISO 8601 timestamp of when this catalog was generated. */
  generatedAt: string;
}

/**
 * MPP-compatible service descriptor.
 *
 * This follows the MPP service discovery pattern, allowing agents
 * to discover payment-enabled endpoints and their pricing before
 * making any calls.
 */
export interface MPPServiceDescriptor {
  /** Protocol identifier. */
  protocol: "mpp";

  /** Protocol version. */
  version: "1.0";

  /** Service name. */
  name: string;

  /** Service URL. */
  url?: string;

  /** Accepted payment networks. */
  networks: string[];

  /** Recipient wallet address. */
  recipient: string;

  /** Whether MPP sessions are supported. */
  sessionsSupported: boolean;

  /** Whether streaming payments are supported. */
  streamingSupported: boolean;

  /** Available paid endpoints/tools. */
  endpoints: MPPEndpointDescriptor[];
}

/**
 * A single endpoint in the MPP service descriptor.
 */
export interface MPPEndpointDescriptor {
  /** Endpoint path or tool identifier. */
  path: string;

  /** HTTP method or protocol (e.g., 'POST', 'MCP'). */
  method: "MCP";

  /** Human-readable description. */
  description?: string;

  /** Pricing for this endpoint. */
  pricing: {
    amount: string;
    currency: string;
    unit: "per_request";
  };

  /** Input schema for the endpoint. */
  inputSchema?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// MCPPaymentDiscovery
// ---------------------------------------------------------------------------

/**
 * Generates discovery documents for MCP tools exposed via MPP.
 *
 * This class reads the bridge's tool registry and produces
 * machine-readable catalogs that agents can use to discover
 * available tools, their pricing, and how to pay for them.
 */
export class MCPPaymentDiscovery {
  private readonly bridge: MCPMPPBridge;

  /**
   * Creates a new discovery instance.
   *
   * @param bridge - The MCP-MPP bridge whose tools will be described
   */
  constructor(bridge: MCPMPPBridge) {
    this.bridge = bridge;
  }

  // ---------------------------------------------------------------------------
  // JSON / JSON-LD Catalog
  // ---------------------------------------------------------------------------

  /**
   * Generate a JSON-LD discovery catalog of all registered paid tools.
   *
   * The catalog includes tool names, descriptions, input schemas,
   * pricing, and accepted payment networks. It uses a JSON-LD context
   * for semantic interoperability with agent frameworks that understand
   * linked data.
   *
   * @returns A discovery catalog document
   */
  describeTools(): DiscoveryCatalog {
    const tools = this.bridge.createToolList();
    const config = this.getBridgeConfig();
    const networks = config.mppConfig?.networks ?? ["tempo", "stripe"];

    return {
      "@context": "https://openagentpay.org/schemas/discovery/v1",
      "@type": "PaidToolCatalog",
      name: config.serviceName ?? "MCP Tool Service",
      description: `${tools.length} paid MCP tool(s) available via MPP`,
      url: config.serviceUrl,
      protocol: "mpp",
      protocolVersion: "1.0",
      acceptedNetworks: networks,
      recipient: config.recipient,
      tools: tools.map((tool) => this.toDiscoveryEntry(tool)),
      generatedAt: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // MPP Service Descriptor
  // ---------------------------------------------------------------------------

  /**
   * Produce an MPP-compatible service descriptor.
   *
   * This descriptor follows the MPP service discovery format,
   * allowing MPP-aware agents to discover endpoints and their
   * pricing without making any tool calls.
   *
   * @returns An MPP service descriptor
   */
  toMPPServiceDescriptor(): MPPServiceDescriptor {
    const tools = this.bridge.createToolList();
    const config = this.getBridgeConfig();
    const networks = config.mppConfig?.networks ?? ["tempo", "stripe"];

    return {
      protocol: "mpp",
      version: "1.0",
      name: config.serviceName ?? "MCP Tool Service",
      url: config.serviceUrl,
      networks,
      recipient: config.recipient,
      sessionsSupported: config.mppConfig?.sessionsSupported ?? false,
      streamingSupported: config.mppConfig?.streamingSupported ?? false,
      endpoints: tools.map((tool) => this.toEndpointDescriptor(tool)),
    };
  }

  // ---------------------------------------------------------------------------
  // Convenience: Single Tool Lookup
  // ---------------------------------------------------------------------------

  /**
   * Get the discovery entry for a single tool by name.
   *
   * @param name - The tool name
   * @returns The discovery entry, or `undefined` if the tool is not found
   */
  describeTool(name: string): DiscoveryToolEntry | undefined {
    const tool = this.bridge.getTool(name);
    if (!tool) return undefined;

    const config = this.getBridgeConfig();
    const networks = config.mppConfig?.networks ?? ["tempo", "stripe"];

    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
      pricing: {
        amount: tool.pricing.amount,
        currency: tool.pricing.currency,
        unit: "per_request",
        description: tool.pricing.description,
      },
      acceptedNetworks: networks,
    };
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Convert a PaidToolDescriptor to a DiscoveryToolEntry.
   */
  private toDiscoveryEntry(tool: PaidToolDescriptor): DiscoveryToolEntry {
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
      pricing: {
        amount: tool.pricing.amount,
        currency: tool.pricing.currency,
        unit: "per_request",
        description: tool.pricing.description,
      },
      acceptedNetworks: tool.networks,
    };
  }

  /**
   * Convert a PaidToolDescriptor to an MPP endpoint descriptor.
   */
  private toEndpointDescriptor(tool: PaidToolDescriptor): MPPEndpointDescriptor {
    return {
      path: `mcp://tool/${tool.name}`,
      method: "MCP",
      description: tool.description,
      pricing: {
        amount: tool.pricing.amount,
        currency: tool.pricing.currency,
        unit: "per_request",
      },
      inputSchema: tool.inputSchema as Record<string, unknown>,
    };
  }

  /**
   * Access the bridge's configuration.
   */
  private getBridgeConfig() {
    return this.bridge.config;
  }
}
