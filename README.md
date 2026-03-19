# OpenAgentPay

### Payment orchestration for the agentic internet.

OpenAgentPay is the **routing and experience layer** for machine-to-machine payments. Not a payment processor — the open-source middleware that connects AI agents to every payment rail through a single integration, with intelligent routing, spend governance, and unified receipts.

Think Juspay HyperCheckout, but for agents paying APIs instead of humans paying merchants.

```
                           ┌──────────────────────────────┐
                           │       OpenAgentPay            │
                           │   Orchestration Layer         │
                           │                               │
     AI Agents             │  ┌─────────┐  ┌───────────┐  │         API Providers
     MCP Tools  ──────────►│  │  Smart   │  │  Policy   │  │────────► MCP Servers
     Services              │  │  Router  │  │  Engine   │  │         Microservices
                           │  └────┬────┘  └─────┬─────┘  │
                           │       │             │         │
                           │  ┌────▼─────────────▼─────┐  │
                           │  │      Cascade/Retry      │  │
                           │  │    Receipt Generation   │  │
                           │  └────────────┬────────────┘  │
                           └───────────────┼───────────────┘
                                           │
                    ┌──────────┬───────────┼──────────┬──────────┐
                    │          │           │          │          │
               ┌────▼───┐ ┌───▼───┐ ┌─────▼────┐ ┌──▼───┐ ┌───▼────┐
               │  MPP   │ │  x402 │ │   Visa   │ │Stripe│ │Credits │
               │ Tempo  │ │ USDC  │ │ AgentCard│ │PayPal│ │  Mock  │
               │ Light. │ │ Base  │ │   MCP    │ │ UPI  │ │        │
               └────────┘ └───────┘ └──────────┘ └──────┘ └────────┘
```

---

## Why orchestration matters

The machine payment landscape is fragmenting. MPP launched last week (Stripe + Tempo + Anthropic + OpenAI). x402 is live (Coinbase). Visa has an MCP server. AgentCard ships virtual debit cards. UPI mandates work in India. Each protocol has its own SDK, its own flow, its own quirks.

Without orchestration, every agent developer integrates each payment method separately. Every API provider picks one method and locks out agents that use a different wallet.

**OpenAgentPay sits in the middle.** Agent integrates once. API provider integrates once. The router figures out which rail to use, the policy engine checks the budget, the cascade manager retries on failure, and the receipt system logs everything — regardless of which payment method was used.

---

## Quick start

### API provider: accept payments from any agent

```typescript
import { createPaywall } from '@openagentpay/server-express';
import { mpp } from '@openagentpay/adapter-mpp';
import { x402 } from '@openagentpay/adapter-x402';
import { credits } from '@openagentpay/adapter-credits';

const paywall = createPaywall({
  recipient: '0xYourWallet',
  adapters: [
    mpp({ networks: ['tempo', 'stripe'] }),
    x402({ network: 'base' }),
    credits({ store }),
  ],
});

app.get('/api/data', paywall({ price: '0.01' }), (req, res) => {
  res.json({ results: ['premium-data'] });
});
```

The 402 response advertises all accepted methods. Any agent with any wallet can pay.

### Agent developer: pay for any API

```typescript
import { withPayment } from '@openagentpay/client';
import { mppWallet } from '@openagentpay/adapter-mpp';

const paidFetch = withPayment(fetch, {
  wallet: mppWallet({ network: 'tempo', privateKey: process.env.KEY }),
  policy: {
    maxPerRequest: '1.00',
    maxPerDay: '50.00',
    allowedDomains: ['*.research.org'],
  },
});

const data = await paidFetch('https://api.research.org/search?q=fusion').then(r => r.json());
// 402 → policy check → pay → retry → done. Your code sees only the result.
```

---

## The orchestration stack

### Layer 1 — Connectors (8 payment rails)

| Adapter | Package | Connects to | Per-call viable? |
|---------|---------|------------|-----------------|
| **MPP** | `adapter-mpp` | Tempo blockchain, Stripe SPT, Lightning | Yes (~$0.001) |
| **x402** | `adapter-x402` | USDC on Base via EIP-3009 | Yes (~$0.001) |
| **Visa** | `adapter-visa` | Visa Intelligent Commerce MCP, AgentCard | Above ~$1.00 |
| **Stripe** | `adapter-stripe` | Stripe PaymentIntents, Checkout credit bridge | Above $0.50 |
| **PayPal** | `adapter-paypal` | PayPal Orders, OAuth2, credit bridge | Above ~$1.00 |
| **UPI** | `adapter-upi` | Razorpay/Cashfree UPI mandates | Yes (near-zero fees in India) |
| **Credits** | `adapter-credits` | Internal prepaid balance, atomic deductions | Yes ($0 per call) |
| **Mock** | `adapter-mock` | Simulated payments | Yes (testing only) |

### Layer 2 — Smart Router

The brain. Selects which adapter to use for each payment based on configurable strategy.

```typescript
import { createRouter } from '@openagentpay/router';

const router = createRouter({
  adapters: [
    { adapter: mpp({ ... }), costPerTransaction: '0.001', currencies: ['USDC'] },
    { adapter: x402({ ... }), costPerTransaction: '0.001', currencies: ['USDC'] },
    { adapter: stripe({ ... }), costPerTransaction: '0.30', costPercentage: 2.9, minimumAmount: '0.50' },
    { adapter: credits({ ... }), costPerTransaction: '0' },
  ],
  strategy: 'smart',
  cascade: true,
});

const decision = router.select({ amount: '0.01', currency: 'USDC' });
// → { adapter: mppAdapter, reason: 'lowest cost with 98% success rate' }
```

**14 routing strategies:**

| # | Strategy | How it selects |
|---|----------|---------------|
| 1 | `priority` | Static priority order |
| 2 | `lowest-cost` | Cheapest viable adapter for the amount |
| 3 | `highest-success` | Best recent success rate (sliding window) |
| 4 | `lowest-latency` | Fastest recent response time |
| 5 | `round-robin` | Even distribution across healthy adapters |
| 6 | `weighted` | Probabilistic by weight (A/B testing payment rails) |
| 7 | `smart` | Composite score: success × 0.5 + cost × 0.3 + latency × 0.2 |
| 8 | `adaptive` | Multi-armed bandit — 10% exploration, 90% exploit best performer |
| 9 | `conditional` | Rule-based if/else routing (define `RoutingRule[]` with conditions) |
| 10 | `amount-tiered` | Different strategy per amount range (micro → crypto, large → cards) |
| 11 | `geo-aware` | Region-based preferences (India → UPI, US → MPP, EU → Stripe) |
| 12 | `time-aware` | Time-of-day optimization with configurable UTC windows |
| 13 | `failover-only` | Sustained primary/secondary switching with recovery probes |
| 14 | `custom` | User-defined scoring function — full control over adapter selection |

**Advanced routing examples:**

```typescript
// Rule-based routing (like Juspay's merchant routing engine)
const router = createRouter({
  adapters: [...],
  strategy: 'conditional',
  rules: [
    { name: 'micro', condition: (r) => parseFloat(r.amount) < 0.50, preferredAdapters: ['mpp', 'x402', 'credits'] },
    { name: 'india', condition: (r) => r.region === 'IN', preferredAdapters: ['upi', 'credits', 'mpp'] },
    { name: 'fiat', condition: (r) => ['USD', 'EUR'].includes(r.currency), preferredAdapters: ['stripe', 'paypal'] },
  ],
});

// Amount-tiered routing
const router = createRouter({
  adapters: [...],
  strategy: 'amount-tiered',
  amountTiers: [
    { name: 'micro', maxAmount: 0.50, strategy: 'lowest-cost', preferredAdapters: ['mpp', 'x402'] },
    { name: 'medium', maxAmount: 10, strategy: 'smart' },
    { name: 'large', maxAmount: Infinity, strategy: 'highest-success' },
  ],
});

// Adaptive (multi-armed bandit) — learns which adapter performs best
const router = createRouter({
  adapters: [...],
  strategy: 'adaptive',
  explorationRate: 0.1,  // 10% traffic tests all adapters, 90% goes to best
});

// Custom scoring — define your own formula
const router = createRouter({
  adapters: [...],
  strategy: 'custom',
  customScoring: (entry, health, cost, request) => {
    const latencyPenalty = health.avgLatencyMs > 500 ? 0.5 : 1.0;
    const costBonus = 1 / (1 + parseFloat(cost.transactionCost));
    return health.successRate * costBonus * latencyPenalty;
  },
});
```

**Health tracking:** Per-adapter success rate, avg/p95 latency, failure counts — sliding time window. Unhealthy adapters are automatically excluded from routing.

**Cascade failover:** If the selected adapter fails, the cascade manager retries with the next-best. Every attempt is logged with adapter type, latency, and error.

### Layer 3 — Policy Engine

Governs spending across all payment methods. 11 rules evaluated before every payment.

```typescript
policy: {
  maxPerRequest: '1.00',        // per-call cap
  maxPerDay: '50.00',           // 24h rolling budget
  maxPerProvider: '10.00',      // per-domain daily cap
  allowedDomains: ['*.trusted.dev'],
  blockedDomains: ['*.sketchy.io'],
  approvalThreshold: '5.00',   // human approval above this
}
```

### Layer 4 — Receipts & Observability

Every payment — regardless of rail — generates a standardized `AgentPaymentReceipt`. Same schema whether the agent paid with USDC, Visa, or UPI.

```typescript
const store = createReceiptStore({ type: 'file', path: './receipts' });
const summary = await store.summary();
// { totalCount: 1432, totalAmount: '14.32', byMethod: { mpp: {...}, x402: {...} } }
const csv = await store.export({ format: 'csv' });
```

OpenTelemetry export via `@openagentpay/otel-exporter`:
- `openagentpay.payments.count` (Counter)
- `openagentpay.payments.amount` (Counter)
- `openagentpay.payments.latency` (Histogram)

### Layer 5 — Server Middleware

One-line paywall for Express or Hono. Subscriptions built in.

```typescript
// Express
import { createPaywall } from '@openagentpay/server-express';
app.get('/api/data', paywall({ price: '0.01' }), handler);
app.use(paywall.routes()); // POST /openagentpay/subscribe, etc.

// Hono
import { createPaywall } from '@openagentpay/server-hono';
app.get('/api/data', paywall({ price: '0.01' }), handler);
app.route('/', paywall.routes());
```

### Layer 6 — MCP Integration

Paid MCP tools with transparent payment.

```typescript
// Server: charge per tool invocation
const search = paidTool({ price: '0.01', adapters: [mpp(...)], recipient: '0x...' },
  async (params) => ({ results: await engine.search(params.query) }));

// Client: agent pays automatically
const client = withMCPPayment(mcpClient, { wallet: mppWallet(...), policy: {...} });
await client.callTool('search', { query: 'test' });
```

---

## All 17 packages

| # | Package | Layer | Description |
|---|---------|-------|-------------|
| 1 | `core` | Foundation | Types, schemas, builders, parsers, 10 error classes. Zero deps. |
| 2 | `router` | Orchestration | Smart routing, health tracking, cost estimation, cascade failover. 14 strategies including adaptive (multi-armed bandit), conditional (rule-based), geo-aware, time-aware, and custom scoring. |
| 3 | `adapter-mpp` | Connector | MPP protocol — Tempo, Stripe SPT, Lightning. Sessions ("OAuth for money"). |
| 4 | `adapter-x402` | Connector | x402 protocol — USDC on Base via EIP-3009 + facilitator. |
| 5 | `adapter-visa` | Connector | Visa Intelligent Commerce MCP + AgentCard virtual debit cards. |
| 6 | `adapter-stripe` | Connector | Stripe PaymentIntents + credit purchase via Checkout. |
| 7 | `adapter-paypal` | Connector | PayPal Orders + credit purchase. OAuth2. |
| 8 | `adapter-upi` | Connector | UPI AutoPay mandates via Razorpay/Cashfree. |
| 9 | `adapter-credits` | Connector | Prepaid balance with atomic deductions. |
| 10 | `adapter-mock` | Connector | Simulated payments for development/testing. |
| 11 | `server-express` | Middleware | Express paywall + subscription endpoints. |
| 12 | `server-hono` | Middleware | Hono paywall + subscription endpoints. |
| 13 | `client` | Agent SDK | `withPayment(fetch)` — auto-402 handling, method selection, retry. |
| 14 | `policy` | Governance | 11 spend rules. Domain globs. Rolling budget tracking. |
| 15 | `receipts` | Observability | Receipt storage (memory/file), query, CSV/JSON export. |
| 16 | `mcp` | Integration | Paid MCP tools — `paidTool()` + `withMCPPayment()`. |
| 17 | `otel-exporter` | Observability | OpenTelemetry spans + metrics. |

---

## Payment method comparison

| Method | Min Amount | Per-Call Fee | Settlement | Best For |
|--------|-----------|-------------|-----------|----------|
| MPP (Tempo) | ~$0.001 | ~$0.001 | Instant | Crypto-native agents |
| x402 (USDC) | ~$0.001 | ~$0.001 | ~200ms | Direct stablecoin |
| MPP (Stripe) | $0.50 | 2.9%+$0.30 | 2-7 days | Fiat via Stripe |
| Visa MCP | ~$1.00 | Card rates | 1-3 days | Enterprise card |
| AgentCard | $1.00 | Card rates | 1-3 days | Quick virtual card |
| Stripe | $0.50 | 2.9%+$0.30 | 2-7 days | Metered billing |
| PayPal | ~$1.00 | 3.49%+$0.49 | 1-3 days | Global reach |
| UPI | Rs 1 (~$0.01) | ~0% | T+1 | India |
| Credits | $0.001 | $0 | Instant | Prepaid budgets |

---

## Examples

```bash
cd examples/paid-weather-api && pnpm start    # API with pricing + subscriptions
cd examples/agent-client && pnpm start         # Agent that auto-pays
cd examples/end-to-end-demo && pnpm start      # Full flow in one script
```

---

## Documentation

| Guide | Covers |
|-------|--------|
| [Getting Started](./docs/getting-started.md) | Install, server setup, client setup |
| [Concepts](./docs/concepts.md) | 402 flow, adapters, policy, receipts |
| [Smart Router](./docs/smart-router.md) | 14 routing strategies, health tracking, cascade failover, cost estimation |
| [Server SDK](./docs/server-sdk.md) | Middleware, pricing, subscriptions, events |
| [Client SDK](./docs/client-sdk.md) | withPayment, policy, spend tracking |
| [Payment Adapters](./docs/payment-adapters.md) | All 8 adapters + custom adapter guide |
| [MPP Integration](./docs/mpp-integration.md) | MPP protocol, sessions, Tempo/Stripe/Lightning |
| [Visa Integration](./docs/visa-integration.md) | Visa MCP, AgentCard virtual cards |
| [Fiat Methods](./docs/fiat-payment-methods.md) | Stripe/PayPal/UPI architecture + fees |
| [Getting Paid](./docs/getting-paid.md) | Wallet setup, fiat conversion, tax, regulatory |
| [Policy Engine](./docs/policy-engine.md) | 11 rules, domain globs, spend tracking |
| [Receipts](./docs/receipts.md) | Storage, querying, export |
| [MCP Tools](./docs/mcp-integration.md) | Paid MCP tools |

## Specifications

- [402 Response Format](./specs/402-response.md) — machine-readable pricing discovery
- [Agent Payment Receipt](./specs/receipt.md) — structured audit record

---

## Development

```bash
git clone https://github.com/alokemajumder/OpenAgentPay.git
cd OpenAgentPay
pnpm install && pnpm build && pnpm test
```

17 packages · 106 TypeScript files · 21,653 lines of code
TypeScript · Turborepo · pnpm · Biome · Vitest · Apache 2.0

## Contributing

[CONTRIBUTING.md](./CONTRIBUTING.md) · [SECURITY.md](./SECURITY.md) · [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
