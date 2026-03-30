import { describe, it, expect } from "vitest";
import type {
  AgentPayDiscovery,
  DiscoveryEndpoint,
} from "../types/discovery.js";

describe("AgentPayDiscovery types", () => {
  it("creates an AgentPayDiscovery object with all required fields", () => {
    const discovery: AgentPayDiscovery = {
      version: "1.0",
      provider: "Acme AI Services",
      methods: ["x402", "credits"],
      currencies: ["USDC", "USD"],
      endpoints: [],
      capabilities: {
        subscriptions: true,
        streaming: false,
        sessions: true,
        receipts: true,
      },
    };

    expect(discovery.version).toBe("1.0");
    expect(discovery.provider).toBe("Acme AI Services");
    expect(discovery.methods).toEqual(["x402", "credits"]);
    expect(discovery.currencies).toEqual(["USDC", "USD"]);
    expect(discovery.endpoints).toHaveLength(0);
    expect(discovery.capabilities.subscriptions).toBe(true);
    expect(discovery.capabilities.streaming).toBe(false);
  });

  it("creates an AgentPayDiscovery object with optional fields", () => {
    const discovery: AgentPayDiscovery = {
      version: "1.0",
      provider: "Acme AI",
      methods: ["x402", "mpp"],
      currencies: ["USDC"],
      endpoints: [],
      capabilities: {
        subscriptions: false,
        streaming: true,
        sessions: true,
        receipts: false,
      },
      mpp: {
        networks: ["base", "polygon"],
        sessions_supported: true,
        streaming_supported: true,
        challenge_url: "https://api.acme.ai/mpp/challenge",
      },
      docs_url: "https://docs.acme.ai",
      tos_url: "https://acme.ai/tos",
    };

    expect(discovery.mpp).toBeDefined();
    expect(discovery.mpp!.networks).toEqual(["base", "polygon"]);
    expect(discovery.mpp!.sessions_supported).toBe(true);
    expect(discovery.mpp!.streaming_supported).toBe(true);
    expect(discovery.mpp!.challenge_url).toBe(
      "https://api.acme.ai/mpp/challenge"
    );
    expect(discovery.docs_url).toBe("https://docs.acme.ai");
    expect(discovery.tos_url).toBe("https://acme.ai/tos");
  });

  it("creates DiscoveryEndpoint objects with pricing", () => {
    const endpoint: DiscoveryEndpoint = {
      path: "/api/search",
      methods: ["GET", "POST"],
      pricing: {
        amount: "0.01",
        currency: "USDC",
        unit: "per_request",
      },
      description: "Search API endpoint",
    };

    expect(endpoint.path).toBe("/api/search");
    expect(endpoint.methods).toEqual(["GET", "POST"]);
    expect(endpoint.pricing.amount).toBe("0.01");
    expect(endpoint.pricing.currency).toBe("USDC");
    expect(endpoint.pricing.unit).toBe("per_request");
    expect(endpoint.description).toBe("Search API endpoint");
  });

  it("creates a free DiscoveryEndpoint", () => {
    const freeEndpoint: DiscoveryEndpoint = {
      path: "/api/health",
      methods: ["GET"],
      pricing: {
        amount: "0",
        currency: "USDC",
        unit: "per_request",
      },
      free: true,
    };

    expect(freeEndpoint.free).toBe(true);
    expect(freeEndpoint.pricing.amount).toBe("0");
  });

  it("supports all pricing unit types", () => {
    const units: Array<"per_request" | "per_kb" | "per_second" | "per_unit"> = [
      "per_request",
      "per_kb",
      "per_second",
      "per_unit",
    ];

    for (const unit of units) {
      const endpoint: DiscoveryEndpoint = {
        path: `/api/${unit}`,
        methods: ["POST"],
        pricing: { amount: "0.05", currency: "USD", unit },
      };
      expect(endpoint.pricing.unit).toBe(unit);
    }
  });

  it("type-narrows discovery with endpoints array", () => {
    const discovery: AgentPayDiscovery = {
      version: "1.0",
      provider: "Test",
      methods: ["x402"],
      currencies: ["USDC"],
      endpoints: [
        {
          path: "/api/v1/*",
          methods: ["GET"],
          pricing: { amount: "0.01", currency: "USDC", unit: "per_request" },
        },
        {
          path: "/api/v1/stream",
          methods: ["POST"],
          pricing: { amount: "0.001", currency: "USDC", unit: "per_second" },
          description: "Streaming endpoint",
        },
      ],
      capabilities: {
        subscriptions: false,
        streaming: true,
        sessions: false,
        receipts: true,
      },
    };

    expect(discovery.endpoints).toHaveLength(2);
    expect(discovery.endpoints[0].path).toBe("/api/v1/*");
    expect(discovery.endpoints[1].pricing.unit).toBe("per_second");

    // Verify endpoints are iterable and can be filtered
    const streamEndpoints = discovery.endpoints.filter(
      (e) => e.pricing.unit === "per_second"
    );
    expect(streamEndpoints).toHaveLength(1);
    expect(streamEndpoints[0].description).toBe("Streaming endpoint");
  });
});
