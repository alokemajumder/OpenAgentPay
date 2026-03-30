import { describe, it, expect } from "vitest";
import { evaluateIdentityRequired } from "../rules/identity-rules.js";
import type { PaymentRequest } from "../engine.js";
import type {
  PolicyConfig,
  AgentAttestation,
} from "@openagentpay/core";

function makeAttestation(overrides: Partial<AgentAttestation> = {}): AgentAttestation {
  return {
    id: "att-1",
    type: "identity",
    issuer: "did:key:z6MkIssuer",
    subject: "did:key:z6MkSubject",
    claims: { role: "agent" },
    signature: "deadbeef",
    issuedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRequest(overrides: Partial<PaymentRequest & { attestations?: AgentAttestation[] }> = {}): PaymentRequest {
  return {
    amount: "1.00",
    currency: "USDC",
    domain: "api.example.com",
    ...overrides,
  } as PaymentRequest;
}

describe("evaluateIdentityRequired", () => {
  it("returns null when identityRequired is not configured", () => {
    const config: PolicyConfig = {};
    const request = makeRequest();

    const result = evaluateIdentityRequired(config, request);
    expect(result).toBeNull();
  });

  it("passes with a valid non-expired attestation", () => {
    const config: PolicyConfig = { identityRequired: true };
    const futureDate = new Date(Date.now() + 3600_000).toISOString();

    const request = makeRequest({
      attestations: [makeAttestation({ expiresAt: futureDate })],
    });

    const result = evaluateIdentityRequired(config, request);
    expect(result).toBeNull();
  });

  it("passes with an attestation that has no expiry", () => {
    const config: PolicyConfig = { identityRequired: true };
    const request = makeRequest({
      attestations: [makeAttestation({ expiresAt: undefined })],
    });

    const result = evaluateIdentityRequired(config, request);
    expect(result).toBeNull();
  });

  it("denies when no attestations are provided", () => {
    const config: PolicyConfig = { identityRequired: true };
    const request = makeRequest();

    const result = evaluateIdentityRequired(config, request);
    expect(result).not.toBeNull();
    expect(result!.outcome).toBe("deny");
    expect(result!.denied_by).toBe("identity_required");
    expect(result!.reason).toContain("none were provided");
  });

  it("denies when attestations array is empty", () => {
    const config: PolicyConfig = { identityRequired: true };
    const request = makeRequest({ attestations: [] });

    const result = evaluateIdentityRequired(config, request);
    expect(result).not.toBeNull();
    expect(result!.outcome).toBe("deny");
  });

  it("denies when all attestations are expired", () => {
    const config: PolicyConfig = { identityRequired: true };
    const pastDate = new Date(Date.now() - 3600_000).toISOString();

    const request = makeRequest({
      attestations: [
        makeAttestation({ id: "att-1", expiresAt: pastDate }),
        makeAttestation({ id: "att-2", expiresAt: pastDate }),
      ],
    });

    const result = evaluateIdentityRequired(config, request);
    expect(result).not.toBeNull();
    expect(result!.outcome).toBe("deny");
    expect(result!.reason).toContain("expired");
  });

  it("passes when at least one attestation is not expired among expired ones", () => {
    const config: PolicyConfig = { identityRequired: true };
    const pastDate = new Date(Date.now() - 3600_000).toISOString();
    const futureDate = new Date(Date.now() + 3600_000).toISOString();

    const request = makeRequest({
      attestations: [
        makeAttestation({ id: "att-expired", expiresAt: pastDate }),
        makeAttestation({ id: "att-valid", expiresAt: futureDate }),
      ],
    });

    const result = evaluateIdentityRequired(config, request);
    expect(result).toBeNull();
  });

  it("denies when required attestation types are missing", () => {
    const config: PolicyConfig = {
      identityRequired: ["identity", "payment-authorization"],
    };
    const futureDate = new Date(Date.now() + 3600_000).toISOString();

    const request = makeRequest({
      attestations: [
        makeAttestation({ type: "identity", expiresAt: futureDate }),
      ],
    });

    const result = evaluateIdentityRequired(config, request);
    expect(result).not.toBeNull();
    expect(result!.outcome).toBe("deny");
    expect(result!.reason).toContain("payment-authorization");
  });

  it("passes when all required attestation types are present", () => {
    const config: PolicyConfig = {
      identityRequired: ["identity", "payment-authorization"],
    };
    const futureDate = new Date(Date.now() + 3600_000).toISOString();

    const request = makeRequest({
      attestations: [
        makeAttestation({ type: "identity", expiresAt: futureDate }),
        makeAttestation({
          id: "att-2",
          type: "payment-authorization",
          expiresAt: futureDate,
        }),
      ],
    });

    const result = evaluateIdentityRequired(config, request);
    expect(result).toBeNull();
  });

  it("ignores expired attestations when checking required types", () => {
    const config: PolicyConfig = {
      identityRequired: ["identity", "payment-authorization"],
    };
    const pastDate = new Date(Date.now() - 3600_000).toISOString();
    const futureDate = new Date(Date.now() + 3600_000).toISOString();

    const request = makeRequest({
      attestations: [
        makeAttestation({ type: "identity", expiresAt: futureDate }),
        makeAttestation({
          id: "att-2",
          type: "payment-authorization",
          expiresAt: pastDate,
        }),
      ],
    });

    const result = evaluateIdentityRequired(config, request);
    expect(result).not.toBeNull();
    expect(result!.outcome).toBe("deny");
    expect(result!.reason).toContain("payment-authorization");
  });
});
