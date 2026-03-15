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
  adapters: [mock()],   // swap for x402() when you're ready for real USDC
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

## The full picture

OpenAgentPay is 11 packages that cover the entire payment lifecycle:

### Payment adapters — how money moves

| Adapter | What happens | When to use |
|---------|-------------|-------------|
| `adapter-mock` | Every payment auto-succeeds. Wallet tracks a fake balance. | Development, testing, CI |
| `adapter-credits` | Agent spends from a prepaid credit account. Atomic balance deductions. | Predictable budgets, no blockchain needed |
| `adapter-x402` | Agent signs an EIP-3009 USDC authorization. Facilitator settles on Base L2. | Production. Real money. |

### Server middleware — how APIs accept payment

| Package | Framework | What it does |
|---------|-----------|-------------|
| `server-express` | Express 4+ | `paywall()` middleware. Static or dynamic pricing. Subscription management. Receipt generation. |
| `server-hono` | Hono 4+ | Same API, adapted for Hono. `paywall()` returns Hono middleware. `routes()` returns a Hono app. |

### Agent-side — how agents pay

| Package | What it does |
|---------|-------------|
| `client` | Wraps `fetch` with `withPayment()`. Detects 402, parses pricing, checks policy, pays, retries. |
| `policy` | Budget engine. 11 rule types. Domain globs. Rolling spend tracking. Approval thresholds. |

### Infrastructure — what happens after payment

| Package | What it does |
|---------|-------------|
| `core` | Every type, interface, schema, error class, builder, and parser. Zero dependencies. |
| `receipts` | Store receipts in memory or on disk. Query by payer, date, method, amount. Export to CSV/JSON. |
| `mcp` | Paid MCP tools. `paidTool()` wraps any tool handler. `withMCPPayment()` wraps any MCP client. |
| `otel-exporter` | OpenTelemetry spans + metrics. `openagentpay.payments.count`, `.amount`, `.latency`. |

---

## Subscriptions — because per-call isn't always cheapest

An agent calling your API 800 times a day at $0.01/call is spending $8. If you offer a $5/day unlimited plan, the agent should subscribe. OpenAgentPay makes this automatic.

```typescript
// Server: define plans
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

The 402 response includes subscription plans alongside per-call pricing. The agent compares costs and picks the cheapest option. Subscriptions use an `X-SUBSCRIPTION` token header — no per-call payment needed.

---

## Policy engine — agents don't spend blindly

Every payment goes through the policy engine first. No exceptions.

```typescript
import { createPolicy } from '@openagentpay/policy';

const policy = createPolicy({
  maxPerRequest: '1.00',       // single call cap
  maxPerDay: '50.00',          // 24h rolling budget
  maxPerSession: '100.00',     // session lifetime budget
  maxPerProvider: '10.00',     // per-domain daily cap
  allowedDomains: ['*.trusted.dev', 'api.research.org'],
  blockedDomains: ['*.sketchy.io'],
  allowedCurrencies: ['USDC'],
  approvalThreshold: '5.00',  // flag for human review above this
  testMode: false,
});

const decision = policy.evaluate({ amount: '0.50', currency: 'USDC', domain: 'api.trusted.dev' });
// → { outcome: 'approve', rules_evaluated: ['test_mode', 'blocked_domains', ...] }
```

11 rules, evaluated in strict order. `blockedDomains` is checked before `allowedDomains`. `approvalThreshold` is checked last. Domain patterns support `*` (single segment) and `**` (multi-segment).

Spend tracking is built in. `policy.getDailyTotal()`, `policy.getSessionTotal()`, `policy.getProviderTotal(domain)` — all updated after each `policy.recordSpend()`.

---

## Receipts — every payment, accounted for

```typescript
import { createReceiptStore } from '@openagentpay/receipts';

const store = createReceiptStore({ type: 'file', path: './data/receipts' });

// Query
const results = await store.query({ payer: '0x1234...', method: 'x402', limit: 50 });

// Summarize
const summary = await store.summary();
// { totalCount: 1432, totalAmount: '14.32', byMethod: { x402: { count: 1200, amount: '12.00' } }, ... }

// Export
const csv = await store.export({ format: 'csv' });
```

Every receipt captures: who paid, what was requested, how much, which payment method, the on-chain transaction hash (for x402), response status code, response content hash, latency, and which policy rules were evaluated. The full schema is in [`specs/receipt.md`](./specs/receipt.md).

---

## Paid MCP tools — monetize any tool invocation

```typescript
// Server: wrap your MCP tool
import { paidTool } from '@openagentpay/mcp';

const search = paidTool({
  price: '0.01', adapters: [mock()], recipient: '0x...',
}, async (params: { query: string }) => {
  return { results: await engine.search(params.query) };
});

// Client: your MCP client handles payment transparently
import { withMCPPayment } from '@openagentpay/mcp';

const client = withMCPPayment(mcpClient, {
  wallet: mockWallet(),
  policy: { maxPerCall: '0.10', maxPerDay: '5.00' },
});

const result = await client.callTool('search', { query: 'fusion energy' });
// → Payment negotiated, verified, and settled. Receipt generated. Result returned.
```

Works with any MCP implementation. No SDK dependency. `withMCPPayment` proxies `callTool`, detects payment requirements in tool results, and handles the rest.

---

## Observability

```typescript
import { createPaymentTracer, createPaymentMetrics } from '@openagentpay/otel-exporter';

const tracer = createPaymentTracer();
const metrics = createPaymentMetrics();

// Plug into any receipt callback
paywall.on('payment:received', (receipt) => {
  tracer.recordPayment(receipt);   // → OTel span with openagentpay.* attributes
  metrics.recordPayment(receipt);  // → counters + latency histogram
});
```

Requires `@opentelemetry/api` as a peer dependency. Bring your own SDK, exporters, and collector.

---

## Examples

```bash
# Start the paid weather API
cd examples/paid-weather-api && pnpm start

# In another terminal — run the agent client
cd examples/agent-client && pnpm start

# Or run the self-contained end-to-end demo (starts its own server)
cd examples/end-to-end-demo && pnpm start
```

| Example | What it shows |
|---------|--------------|
| `paid-weather-api` | Express API with $0.005/call weather, $0.01/day dynamic forecast pricing, two subscription plans |
| `agent-client` | Agent that auto-discovers pricing, pays with mock wallet, handles policy denials |
| `end-to-end-demo` | Single script: starts server, gets 402, pays, subscribes, uses subscription, unsubscribes |

---

## Project structure

```
openagentpay/
├── packages/
│   ├── core/              # types, schemas, builders, parsers — zero deps
│   ├── adapter-mock/      # simulated payments
│   ├── adapter-credits/   # prepaid balance system
│   ├── adapter-x402/      # USDC on Base (EIP-3009)
│   ├── server-express/    # Express middleware
│   ├── server-hono/       # Hono middleware
│   ├── client/            # agent HTTP client (wraps fetch)
│   ├── policy/            # spend governance engine
│   ├── receipts/          # receipt storage + query + export
│   ├── mcp/               # paid MCP tool adapter
│   └── otel-exporter/     # OpenTelemetry integration
├── examples/              # 3 runnable demos
├── specs/                 # 402 response + receipt format specs
└── docs/                  # 8 guides
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

Built with TypeScript, Turborepo, pnpm workspaces, Biome, and Vitest.

---

## Specifications

- [402 Response Format](./specs/402-response.md) — the machine-readable pricing schema agents parse
- [Agent Payment Receipt](./specs/receipt.md) — the structured audit record every payment generates

Full project scope, progress, and architecture decisions: [SCOPE.md](./SCOPE.md)

---

## Contributing

[CONTRIBUTING.md](./CONTRIBUTING.md)

## Security

[SECURITY.md](./SECURITY.md)

## License

[Apache 2.0](./LICENSE)
