# OpenAgentPay

### The payment layer for the agentic internet.

Your AI agent just found the perfect API. It knows the endpoint, it knows what data it needs, and it's ready to call. But there's a paywall. And your agent can't pay.

**OpenAgentPay fixes that.**

One middleware line on the server. One wrapper on the client. The agent discovers the price, evaluates its budget, pays, gets the data, and moves on — all in milliseconds, all without a human touching anything.

```
Agent  →  GET /api/search?q=climate-data
Server →  402 Payment Required  { amount: "0.01", currency: "USDC" }
Agent  →  Policy check... approved. Paying.
Agent  →  GET /api/search?q=climate-data  [X-PAYMENT: <proof>]
Server →  200 OK  { results: [...] }  [receipt generated]
```

---

## What you get in 3 minutes

### You run an API. You want agents to pay for it.

```typescript
import express from 'express';
import { createPaywall } from '@openagentpay/server-express';
import { mock } from '@openagentpay/adapter-mock';

const app = express();
const paywall = createPaywall({
  recipient: '0xYourWallet',
  adapters: [mock()],   // swap for x402() for real USDC, stripe() for Stripe, etc.
});

app.get('/api/search', paywall({ price: '0.01' }), (req, res) => {
  res.json({ results: ['satellite-data', 'ocean-temps', 'co2-levels'] });
});

app.listen(3000);
```

That's it. Your endpoint now returns `402 Payment Required` with machine-readable pricing. Any agent that speaks the OpenAgentPay protocol can pay and use it instantly.

### You're building an agent. You want it to pay for APIs.

```typescript
import { withPayment } from '@openagentpay/client';
import { mockWallet } from '@openagentpay/adapter-mock';

const paidFetch = withPayment(fetch, {
  wallet: mockWallet(),
  policy: {
    maxPerRequest: '1.00',
    maxPerDay: '50.00',
    allowedDomains: ['api.climate.dev', '*.research.org'],
  },
  onReceipt: (receipt) => {
    console.log(`Paid ${receipt.payment.amount} for ${receipt.request.url}`);
  },
});

// Your agent uses this exactly like fetch. Payments happen behind the scenes.
const data = await paidFetch('https://api.climate.dev/search?q=ocean-temps').then(r => r.json());
```

The agent hits the endpoint, gets a 402 back, checks its policy engine ("Am I allowed to pay this domain? Is the amount within my budget?"), pays, retries, and returns the data. Your code never sees the payment dance.

---

## 14 packages. 87 source files. 16,966 lines of TypeScript.

### Payment adapters — how money moves

| Adapter | Package | What happens | When to use |
|---------|---------|-------------|-------------|
| **Mock** | `adapter-mock` | Every payment auto-succeeds. Fake balance tracked. | Development, testing, CI |
| **Credits** | `adapter-credits` | Agent spends from a prepaid balance. Atomic deductions via `InMemoryCreditStore`. | Predictable budgets, zero per-call fees |
| **x402 (USDC)** | `adapter-x402` | Agent signs EIP-3009 authorization. Facilitator settles on Base L2. | Production crypto payments |
| **Stripe** | `adapter-stripe` | Verify PaymentIntents via Stripe REST API. `StripeCreditBridge` for credit purchases via Checkout. | Fiat payments (US/EU) |
| **PayPal** | `adapter-paypal` | Verify Orders via PayPal REST API. `PayPalCreditBridge` for credit purchases. OAuth2 auth. | Global fiat payments |
| **UPI** | `adapter-upi` | Verify transactions via Razorpay/Cashfree. `UPIMandateManager` for AutoPay mandates. | India (near-zero fees) |

### Server middleware — how APIs accept payment

| Package | Framework | Key export |
|---------|-----------|------------|
| `server-express` | Express 4+ | `createPaywall(config)` → Express middleware. Subscriptions via `paywall.routes()`. |
| `server-hono` | Hono 4+ | `createPaywall(config)` → Hono middleware. Subscriptions via `paywall.routes()`. |

### Agent-side — how agents pay

| Package | Key export | What it does |
|---------|------------|-------------|
| `client` | `withPayment(fetch, config)` | Wraps native `fetch`. Detects 402, parses pricing, checks policy, pays, retries, collects receipts. |
| `policy` | `createPolicy(config)` | 11 spend rules. Domain globs (`*`, `**`). Rolling 24h spend tracking. Approval thresholds. |

### Infrastructure

| Package | Key exports | What it does |
|---------|-------------|-------------|
| `core` | Types, builders, parsers, errors | Every type, schema, and utility. Zero dependencies. 10 error classes. |
| `receipts` | `createReceiptStore(config)` | Memory or file-based storage. Query by payer, payee, date, amount, method. CSV/JSON export. |
| `mcp` | `paidTool()`, `withMCPPayment()` | Paid MCP tools. Server wraps tool handlers. Client auto-pays transparently. |
| `otel-exporter` | `createPaymentTracer()`, `createPaymentMetrics()` | OpenTelemetry spans + metrics (`openagentpay.payments.*`). |

---

## Payment methods — the economics

| $0.01 API call | x402 (USDC) | Stripe | PayPal | UPI (India) |
|----------------|-------------|--------|--------|-------------|
| Per-call fee | ~$0.001 | Not possible (min $0.50) | $0.49 | ~$0.00 |
| Best strategy | Pay directly | Aggregate via metered billing | Aggregate via billing agreement | Aggregate via AutoPay mandate |
| Credits bridge | N/A | Buy $50 credits via Checkout, deduct per-call | Buy credits via PayPal order, deduct per-call | Buy credits via UPI payment, deduct per-call |

**Fiat adapters support two modes:**
1. **Credits bridge** (recommended for micropayments) — agent purchases credits via Stripe/PayPal/UPI, credits are spent per-call with zero processing fees
2. **Direct charge** (for larger amounts) — per-call charges against a saved payment method (Stripe minimum $0.50)

---

## The 402 payment flow

```
AI Agent                               Paid API
   │                                      │
   │  GET /api/search?q=test              │
   │─────────────────────────────────────►│
   │                                      │
   │  402 Payment Required                │
   │  {                                   │
   │    type: "payment_required",         │
   │    pricing: {                        │
   │      amount: "0.01",                 │
   │      currency: "USDC",              │
   │      unit: "per_request"            │
   │    },                                │
   │    methods: [                        │
   │      { type: "x402", ... },          │
   │      { type: "stripe", ... },        │
   │      { type: "credits", ... }        │
   │    ],                                │
   │    subscriptions: [                  │
   │      { id: "daily", amount: "5.00",  │
   │        period: "day", calls: 1000 }  │
   │    ]                                 │
   │  }                                   │
   │◄─────────────────────────────────────│
   │                                      │
   │  [Policy: amount OK? domain OK?]     │
   │  [Select method → pay → retry]       │
   │                                      │
   │  GET /api/search?q=test              │
   │  X-PAYMENT: <proof>                  │
   │─────────────────────────────────────►│
   │                                      │
   │  [Verify → serve → receipt]          │
   │                                      │
   │  200 OK  { results: [...] }          │
   │◄─────────────────────────────────────│
```

---

## Subscriptions

Agents that call the same API repeatedly can subscribe instead of paying per call.

```typescript
const paywall = createPaywall({
  recipient: '0x...',
  adapters: [mock()],
  subscriptions: {
    plans: [
      { id: 'daily-unlimited', amount: '5.00', currency: 'USDC', period: 'day', calls: 'unlimited' },
      { id: 'daily-1000', amount: '2.50', currency: 'USDC', period: 'day', calls: 1000, rate_limit: 60 },
    ],
  },
});

app.use(paywall.routes());
// → POST /openagentpay/subscribe
// → GET  /openagentpay/subscription
// → POST /openagentpay/unsubscribe
```

Plans are advertised in the 402 response. Agents compare per-call vs. subscription cost and pick the cheapest. Active subscriptions use `X-SUBSCRIPTION` header — no per-call payment.

---

## Policy engine

Every payment goes through the policy engine first. No exceptions.

```typescript
import { createPolicy } from '@openagentpay/policy';

const policy = createPolicy({
  maxPerRequest: '1.00',
  maxPerDay: '50.00',
  maxPerProvider: '10.00',
  allowedDomains: ['*.trusted.dev'],
  blockedDomains: ['*.sketchy.io'],
  allowedCurrencies: ['USDC'],
  approvalThreshold: '5.00',
});

const result = policy.evaluate({ amount: '0.50', currency: 'USDC', domain: 'api.trusted.dev' });
// → { outcome: 'approve', rules_evaluated: [...] }
```

11 rules, strict evaluation order. `policy.getDailyTotal()`, `policy.getSessionTotal()`, `policy.getProviderTotal(domain)` for spend tracking.

---

## Receipts

Every payment generates a structured receipt. Query, aggregate, export.

```typescript
import { createReceiptStore } from '@openagentpay/receipts';

const store = createReceiptStore({ type: 'file', path: './data/receipts' });

const results = await store.query({ payer: '0x1234...', method: 'x402', limit: 50 });
const summary = await store.summary();
const csv = await store.export({ format: 'csv' });
```

Receipt fields: payer, payee, endpoint, amount, currency, method, transaction hash, response status, content hash, latency, policy decision. Full schema in [`specs/receipt.md`](./specs/receipt.md).

---

## Paid MCP tools

```typescript
// Server: wrap any MCP tool with payment
import { paidTool } from '@openagentpay/mcp';
const search = paidTool({ price: '0.01', adapters: [mock()], recipient: '0x...' },
  async (params) => ({ results: await engine.search(params.query) })
);

// Client: agent pays for MCP tools transparently
import { withMCPPayment } from '@openagentpay/mcp';
const client = withMCPPayment(mcpClient, { wallet: mockWallet(), policy: { maxPerCall: '0.10' } });
const result = await client.callTool('search', { query: 'fusion energy' });
```

Works with any object that has a `callTool(name, params)` method. No MCP SDK dependency.

---

## OpenTelemetry

```typescript
import { createPaymentTracer, createPaymentMetrics } from '@openagentpay/otel-exporter';

const tracer = createPaymentTracer();
const metrics = createPaymentMetrics();

paywall.on('payment:received', (receipt) => {
  tracer.recordPayment(receipt);
  metrics.recordPayment(receipt);
});
```

Metrics: `openagentpay.payments.count`, `openagentpay.payments.amount`, `openagentpay.payments.latency`, `openagentpay.payments.failures`. Requires `@opentelemetry/api` as peer dependency.

---

## Getting paid

OpenAgentPay is not a payment processor — it's middleware.

- **[Getting Paid Guide](./docs/getting-paid.md)** — wallet setup, USDC settlement, fiat offramps, tax/regulatory FAQ
- **[Fiat Payment Methods](./docs/fiat-payment-methods.md)** — Stripe metered billing, PayPal billing agreements, UPI AutoPay mandates, fee comparison

---

## Examples

```bash
cd examples/paid-weather-api && pnpm start   # Express API with pricing + subscriptions
cd examples/agent-client && pnpm start        # Agent that auto-pays (run weather API first)
cd examples/end-to-end-demo && pnpm start     # Self-contained: starts server, pays, subscribes
```

---

## Project structure

```
openagentpay/                    14 packages · 87 TS files · 16,966 lines
├── packages/
│   ├── core/                    types, schemas, builders, parsers — zero deps
│   ├── adapter-mock/            simulated payments
│   ├── adapter-credits/         prepaid balance system
│   ├── adapter-x402/            USDC on Base (EIP-3009)
│   ├── adapter-stripe/          Stripe integration + credit bridge
│   ├── adapter-paypal/          PayPal integration + credit bridge
│   ├── adapter-upi/             UPI integration + mandate manager
│   ├── server-express/          Express middleware
│   ├── server-hono/             Hono middleware
│   ├── client/                  agent HTTP client (wraps fetch)
│   ├── policy/                  spend governance engine
│   ├── receipts/                receipt storage + query + export
│   ├── mcp/                     paid MCP tool adapter
│   └── otel-exporter/           OpenTelemetry integration
├── examples/                    3 runnable demos
├── specs/                       402 response + receipt format specs
└── docs/                        10 guides
```

---

## Development

```bash
git clone https://github.com/alokemajumder/OpenAgentPay.git
cd OpenAgentPay
pnpm install
pnpm build
pnpm test
```

Built with TypeScript (ES2022), Turborepo, pnpm workspaces, Biome, and Vitest.

---

## Documentation

| Guide | What it covers |
|-------|---------------|
| [Getting Started](./docs/getting-started.md) | Install, server setup, client setup, switching to real payments |
| [Concepts](./docs/concepts.md) | 402 flow, adapters, policy engine, receipts, subscriptions |
| [Server SDK](./docs/server-sdk.md) | Express/Hono middleware, pricing, subscriptions, events |
| [Client SDK](./docs/client-sdk.md) | withPayment, policy config, spend tracking, error handling |
| [Payment Adapters](./docs/payment-adapters.md) | Mock, credits, x402, custom adapters |
| [Fiat Payment Methods](./docs/fiat-payment-methods.md) | Stripe, PayPal, UPI — architecture, fees, integration |
| [Getting Paid](./docs/getting-paid.md) | Wallet setup, USDC settlement, fiat conversion, tax |
| [Policy Engine](./docs/policy-engine.md) | 11 rules, domain globs, spend tracking, evaluation order |
| [Receipts](./docs/receipts.md) | Storage, querying, aggregation, CSV/JSON export |
| [MCP Integration](./docs/mcp-integration.md) | Paid MCP tools — server wrapper, client auto-payment |

## Specifications

| Spec | What it defines |
|------|----------------|
| [402 Response Format](./specs/402-response.md) | Machine-readable pricing schema agents parse |
| [Agent Payment Receipt](./specs/receipt.md) | Structured audit record for every payment |

---

## Contributing

[CONTRIBUTING.md](./CONTRIBUTING.md)

## Security

[SECURITY.md](./SECURITY.md)

## License

[Apache 2.0](./LICENSE)
