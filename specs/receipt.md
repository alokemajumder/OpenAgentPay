# Agent Payment Receipt Specification

**Version:** 1.0
**Status:** Draft
**Date:** 2026-03-15

---

## Abstract

This document specifies the Agent Payment Receipt (APR) format — a structured, verifiable record of every payment made by an AI agent to an API provider. Receipts enable cost attribution, compliance auditing, dispute resolution, and agent performance analytics.

## Motivation

As AI agents autonomously spend money on API services, organizations need:
- **Cost attribution**: Which agent spent how much on which task?
- **Compliance**: Immutable record of every autonomous spending decision
- **Disputes**: Cryptographic proof that payment was made and a response was delivered
- **Analytics**: Cost-per-task, cost-per-provider, spend trends

No standard format for machine-generated payment receipts exists. This specification fills that gap.

## Schema

```json
{
  "id": "01HX3KQVR8ABCDEFGHJKMNPQRS",
  "version": "1.0",
  "timestamp": "2026-03-15T12:00:00.000Z",

  "payer": {
    "type": "agent",
    "identifier": "0x1234...abcd",
    "agent_id": "research-agent-v2",
    "organization_id": "org_acme"
  },

  "payee": {
    "provider_id": "weather-api",
    "identifier": "0x5678...efgh",
    "endpoint": "/api/weather?city=London"
  },

  "request": {
    "method": "GET",
    "url": "/api/weather?city=London",
    "body_hash": "sha256:e3b0c442...",
    "tool_name": "weather-lookup",
    "task_id": "task_abc123",
    "session_id": "sess_xyz789"
  },

  "payment": {
    "amount": "0.01",
    "currency": "USDC",
    "method": "x402",
    "transaction_hash": "0xabc...def",
    "network": "base",
    "status": "settled"
  },

  "response": {
    "status_code": 200,
    "content_hash": "sha256:a1b2c3d4...",
    "content_length": 1024,
    "latency_ms": 342
  },

  "policy": {
    "decision": "auto_approved",
    "rules_evaluated": ["maxPerRequest", "maxPerDay", "allowedDomains"],
    "budget_remaining": "49.99"
  },

  "signature": "0x..."
}
```

## Fields

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique receipt ID. ULID recommended (sortable, timestamp-embedded) |
| `version` | `string` | Schema version. Currently `"1.0"` |
| `timestamp` | `string` | ISO 8601 timestamp of the payment |
| `payer` | `object` | Identity of the paying entity |
| `payer.type` | `string` | `"agent"` or `"service"` |
| `payer.identifier` | `string` | Wallet address or account ID |
| `payee` | `object` | Identity of the receiving entity |
| `payee.identifier` | `string` | Provider wallet address or account ID |
| `payee.endpoint` | `string` | The API endpoint that was called |
| `request` | `object` | Details of the HTTP request |
| `request.method` | `string` | HTTP method (GET, POST, etc.) |
| `request.url` | `string` | Request URL |
| `payment` | `object` | Payment details |
| `payment.amount` | `string` | Decimal amount paid |
| `payment.currency` | `string` | Currency code or token symbol |
| `payment.method` | `string` | Payment method: `"x402"`, `"credits"`, `"mock"` |
| `payment.status` | `string` | `"settled"`, `"pending"`, `"failed"` |
| `response` | `object` | Response summary |
| `response.status_code` | `number` | HTTP status code of the response |
| `response.content_hash` | `string` | SHA-256 hash of response body |
| `response.content_length` | `number` | Response body size in bytes |
| `response.latency_ms` | `number` | Time to serve the response in milliseconds |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `payer.agent_id` | `string` | Human-readable agent identifier |
| `payer.organization_id` | `string` | Organization the agent belongs to |
| `payee.provider_id` | `string` | Provider name or identifier |
| `request.body_hash` | `string` | SHA-256 of request body |
| `request.tool_name` | `string` | MCP tool name, if applicable |
| `request.task_id` | `string` | Task/workflow ID for cost attribution |
| `request.session_id` | `string` | Session ID for grouping related calls |
| `payment.transaction_hash` | `string` | On-chain transaction hash (x402) |
| `payment.network` | `string` | Blockchain network (x402) |
| `policy` | `object` | Policy engine decision log |
| `policy.decision` | `string` | `"auto_approved"`, `"manual_approved"`, `"budget_checked"` |
| `policy.rules_evaluated` | `string[]` | List of policy rules checked |
| `policy.budget_remaining` | `string` | Remaining budget after this payment |
| `signature` | `string` | Cryptographic signature for non-repudiation |

## Use Cases

### Cost Attribution
```
SELECT task_id, SUM(payment.amount) as total_cost
FROM receipts
WHERE payer.organization_id = 'org_acme'
GROUP BY task_id
```

### Compliance Audit
Every autonomous spending decision is recorded with:
- What was purchased (endpoint, request details)
- How much was spent (amount, currency)
- Why it was approved (policy decision, rules evaluated)
- What was received (response hash, status code)

### Dispute Resolution
The `response.content_hash` proves what was delivered in exchange for payment. Combined with `payment.transaction_hash`, this creates a non-repudiable record of the transaction.

### Agent Performance Analytics
```
Average cost per API call: $0.01
Average latency: 342ms
Calls per day: 1,432
Daily spend: $14.32
Most expensive provider: data-api.com ($4.20/day)
```

## Export Formats

### JSON
```json
[
  { "id": "...", "timestamp": "...", ... },
  { "id": "...", "timestamp": "...", ... }
]
```

### CSV
```csv
id,timestamp,payer,payee,endpoint,amount,currency,method,status,transaction_hash,latency_ms,task_id
01HX3K...,2026-03-15T12:00:00Z,0x1234...,0x5678...,/api/weather,0.01,USDC,x402,settled,0xabc...,342,task_abc123
```

## Security Considerations

- Receipt IDs MUST be unique and non-guessable (ULID recommended)
- Content hashes MUST use SHA-256
- Receipts SHOULD be stored in append-only fashion for audit integrity
- The optional `signature` field enables non-repudiation when signed by the payer
- Receipts MUST NOT contain sensitive request/response data — only hashes

## References

- ULID Specification: https://github.com/ulid/spec
- SHA-256: FIPS 180-4
- ISO 8601: Date and time format
- OpenAgentPay 402 Response Format: ./402-response.md
