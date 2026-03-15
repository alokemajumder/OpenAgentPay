# OpenAgentPay 402 Response Format Specification

**Version:** 1.0
**Status:** Draft
**Date:** 2026-03-15

---

## Abstract

This document specifies the machine-readable response body format for HTTP 402 Payment Required responses in the context of AI agent-to-API payments. The format enables autonomous agents to discover pricing, available payment methods, and subscription options for any HTTP API endpoint.

## Motivation

HTTP 402 Payment Required has been reserved since HTTP/1.1 (RFC 2616, 1999) but never formally specified. As AI agents increasingly need to autonomously discover and pay for API services, a standard machine-readable format for payment requirements is essential.

This specification defines a JSON response body that:
- Declares the price of the requested resource
- Lists available payment methods (x402, credits, etc.)
- Advertises optional subscription plans
- Provides metadata for human-readable documentation

## Specification

### Content-Type

The response MUST use `Content-Type: application/json`.

### Response Body

```json
{
  "type": "payment_required",
  "version": "1.0",
  "resource": "/api/search",
  "pricing": {
    "amount": "0.01",
    "currency": "USDC",
    "unit": "per_request",
    "description": "Premium search query"
  },
  "subscriptions": [
    {
      "id": "daily-1000",
      "amount": "5.00",
      "currency": "USDC",
      "period": "day",
      "calls": 1000,
      "description": "1,000 calls/day"
    }
  ],
  "methods": [
    {
      "type": "x402",
      "network": "base",
      "asset": "USDC",
      "asset_address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "pay_to": "0x...",
      "facilitator_url": "https://x402.org/facilitator"
    }
  ],
  "meta": {
    "provider": "Example API",
    "docs_url": "https://api.example.com/docs",
    "subscribe_url": "https://api.example.com/openagentpay/subscribe"
  }
}
```

### Fields

#### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `type` | `string` | MUST be `"payment_required"` |
| `version` | `string` | Schema version. Currently `"1.0"` |
| `resource` | `string` | The URL path of the requested resource |
| `pricing` | `object` | Per-request pricing information |
| `pricing.amount` | `string` | Decimal amount (e.g., `"0.01"`) |
| `pricing.currency` | `string` | Currency code (ISO 4217 or token symbol) |
| `pricing.unit` | `string` | One of: `per_request`, `per_kb`, `per_second`, `per_unit` |
| `methods` | `array` | At least one payment method |

#### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `pricing.description` | `string` | Human-readable pricing description |
| `subscriptions` | `array` | Available subscription plans |
| `meta` | `object` | Provider metadata |

### Payment Method Types

#### x402 (Stablecoin)

```json
{
  "type": "x402",
  "network": "base",
  "asset": "USDC",
  "asset_address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "pay_to": "0x...",
  "facilitator_url": "https://x402.org/facilitator",
  "max_timeout_seconds": 300
}
```

#### Credits (Prepaid Balance)

```json
{
  "type": "credits",
  "purchase_url": "https://api.example.com/credits/buy",
  "balance_url": "https://api.example.com/credits/balance"
}
```

### Subscription Plans

```json
{
  "id": "daily-1000",
  "amount": "5.00",
  "currency": "USDC",
  "period": "hour|day|week|month",
  "calls": 1000,
  "rate_limit": 60,
  "description": "1,000 calls/day",
  "auto_renew": true
}
```

The `calls` field MAY be the string `"unlimited"` for uncapped plans.

## Client Behavior

Upon receiving a 402 response:

1. Parse the response body as JSON
2. Validate the `type` field equals `"payment_required"`
3. Evaluate whether to pay per-call or subscribe (cost optimization)
4. Select a supported payment method from the `methods` array
5. Construct and submit payment using the selected method
6. Retry the original request with the payment proof header

## Versioning

The `version` field enables forward compatibility. Clients SHOULD ignore unknown fields. Servers MUST include the `version` field.

## Security Considerations

- Servers MUST validate payment amounts match the declared pricing
- Clients SHOULD enforce spend limits before submitting payment
- Payment proof MUST include replay protection (nonces)
- Facilitator URLs SHOULD use HTTPS

## References

- HTTP 402: RFC 9110, Section 15.5.3
- x402 Protocol: https://github.com/coinbase/x402
- EIP-3009: https://eips.ethereum.org/EIPS/eip-3009
- EIP-712: https://eips.ethereum.org/EIPS/eip-712
