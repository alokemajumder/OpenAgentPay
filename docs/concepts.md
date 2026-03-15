# Core Concepts

## The 402 Payment Flow

OpenAgentPay uses HTTP 402 Payment Required to enable machine-to-machine payments. The flow is:

```
Agent                              Paid API
  │                                   │
  │  1. GET /api/data                 │
  │──────────────────────────────────►│
  │                                   │
  │  2. 402 Payment Required          │
  │  {                                │
  │    pricing: { amount: "0.01" },   │
  │    methods: [{ type: "x402" }],   │
  │    subscriptions: [...]           │
  │  }                                │
  │◄──────────────────────────────────│
  │                                   │
  │  3. Agent evaluates policy        │
  │  4. Agent selects payment method  │
  │  5. Agent signs payment           │
  │                                   │
  │  6. GET /api/data                 │
  │  X-PAYMENT: <signed proof>        │
  │──────────────────────────────────►│
  │                                   │
  │  7. Server verifies payment       │
  │  8. Server serves response        │
  │                                   │
  │  9. 200 OK { data: [...] }        │
  │  X-RECEIPT: <receipt-id>          │
  │◄──────────────────────────────────│
```

## Payment Methods

### Mock (Testing)
- No real money moves
- Every payment is auto-approved
- Use during development and CI

### Credits (Prepaid Balance)
- Agent pre-purchases credits
- Credits are deducted per call
- No per-call transaction fees
- Good for predictable budgets

### x402 (Stablecoins)
- USDC payments on Base (L2)
- Sub-cent transaction fees
- Instant settlement
- No account required

## Policy Engine

The policy engine prevents runaway agent spending. It evaluates rules before every payment:

| Rule | What It Does |
|------|-------------|
| `maxPerRequest` | Maximum per single call |
| `maxPerDay` | Daily budget cap |
| `maxPerSession` | Session budget cap |
| `maxPerProvider` | Per-provider daily cap |
| `allowedDomains` | Only pay trusted domains |
| `blockedDomains` | Never pay these domains |
| `allowedCurrencies` | Restrict to specific currencies |
| `approvalThreshold` | Require human approval above this amount |
| `testMode` | Only allow mock payments |

## Receipts

Every payment generates a structured receipt containing:
- **Who** paid (agent identity, wallet address)
- **What** was requested (endpoint, method, request hash)
- **How much** was paid (amount, currency, transaction hash)
- **What** was received (response hash, status code, latency)
- **Why** it was approved (policy decision, rules evaluated)

Receipts enable cost attribution, compliance auditing, and dispute resolution.

## Subscriptions

When per-call payments get expensive, agents can subscribe:

1. Agent detects per-call cost: $0.01 × 800 calls/day = $8/day
2. Daily subscription available: $5/day unlimited
3. Agent auto-subscribes, saves 37%
4. Uses `X-SUBSCRIPTION` header instead of per-call payment
5. Auto-cancels when task completes

## Adapters

OpenAgentPay uses an adapter pattern for payment methods. Each adapter implements:
- `detect(req)` — does this request carry payment?
- `verify(req, pricing)` — is the payment valid and sufficient?
- `pay(method, pricing)` — execute payment (client side)
- `supports(method)` — can this adapter handle this payment method?

This makes it easy to add new payment methods without changing core logic.
