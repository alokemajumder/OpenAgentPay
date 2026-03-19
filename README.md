# OpenAgentPay

### Payment orchestration for the agentic internet.

OpenAgentPay is a **payment orchestration layer** for machine-to-machine commerce. It connects API providers to every agent payment method through a unified protocol — multi-protocol acceptance, intelligent routing, spend governance, and unified receipts.

**API owners** install OpenAgentPay server-side. It returns a standardized 402 response with pricing and all accepted payment methods. **Agents** use the OpenAgentPay client SDK (lightweight, wraps `fetch`) or any client that understands the OpenAgentPay 402 format to discover pricing, select a method, pay, and retry.

```
                                OpenAgentPay
                           (installed by API owner)
                                     │
      ┌──────────────────────────────┼──────────────────────────────┐
      │                              │                              │
      │    ┌─────────────────────────▼─────────────────────────┐    │
      │    │              Paywall Middleware                    │    │
      │    │                                                   │    │
      │    │   402 Response ──► Detect ──► Verify ──► Serve    │    │
      │    │   (pricing)        (header)   (adapter)  (data)   │    │
      │    │                                                   │    │
      │    │   Smart Router ──► Cascade ──► Health ──► Receipt  │    │
      │    │   (14 strategies)  (failover)  (tracking) (audit) │    │
      │    └───────────────────────┬───────────────────────────┘    │
      │                            │                                │
      └────────────────────────────┼────────────────────────────────┘
                                   │
              ┌────────┬───────────┼───────────┬────────┐
              │        │           │           │        │
           ┌──▼──┐  ┌──▼──┐  ┌────▼───┐  ┌───▼──┐  ┌──▼────┐
           │ MPP │  │x402 │  │  Visa  │  │Stripe│  │Credits│
           │     │  │USDC │  │AgentCrd│  │PayPal│  │ Mock  │
           │Tempo│  │Base │  │  MCP   │  │ UPI  │  │       │
           └─────┘  └─────┘  └────────┘  └──────┘  └───────┘
```

---

## How it works

### The API owner integrates OpenAgentPay (server-side)

```typescript
import { createPaywall } from '@openagentpay/server-express';
import { mpp } from '@openagentpay/adapter-mpp';
import { x402 } from '@openagentpay/adapter-x402';

const paywall = createPaywall({
  recipient: '0xYourWallet',
  adapters: [
    mpp({ networks: ['tempo', 'stripe'] }),
    x402({ network: 'base' }),
  ],
});

app.get('/api/data', paywall({ price: '0.01' }), (req, res) => {
  res.json({ results: ['premium-data'] });
});
```

That's it. The endpoint now:
1. Returns **402 Payment Required** with machine-readable pricing if no payment is attached
2. **Detects** payment proof from any agent using any supported protocol
3. **Verifies** the payment through the appropriate adapter
4. **Serves** the response and generates a receipt

### Agent-side: lightweight client SDK

The agent installs the OpenAgentPay client — a lightweight `fetch` wrapper that handles the unified 402 format:

```typescript
import { withPayment } from '@openagentpay/client';
import { mppWallet } from '@openagentpay/adapter-mpp';

const paidFetch = withPayment(fetch, {
  wallet: mppWallet({ network: 'tempo', privateKey: process.env.KEY }),
  policy: {
    maxPerRequest: '1.00',
    maxPerDay: '50.00',
    allowedDomains: ['*.trusted.dev'],
  },
});

// Receives 402 → parses pricing → checks policy → selects method → pays → retries
await paidFetch('https://api.trusted.dev/data');
```

The client SDK handles:
- Parsing OpenAgentPay's unified 402 response (pricing + all accepted methods)
- Selecting the best payment method the agent's wallet supports
- Policy enforcement (spend limits, domain rules, approval thresholds)
- Payment execution via the wallet adapter
- Automatic retry with payment proof
- Receipt collection

**Payment proof headers are protocol-standard** — once the agent pays, the header it sends (`X-PAYMENT` for x402, `Authorization: MPP` for MPP, etc.) uses the native protocol format. The server-side adapter verifies it against the real payment processor.

| Protocol | Payment header sent by agent | Verified by |
|----------|----------------------------|-------------|
| MPP | `Authorization: MPP <credential>` | Tempo RPC / Stripe API |
| x402 | `X-PAYMENT: <base64 EIP-3009>` | x402 facilitator |
| Visa | `X-VISA-TOKEN: <tokenized card>` | Visa MCP / payment gateway |
| Stripe | `X-STRIPE-SESSION: <intent ID>` | Stripe REST API |
| PayPal | `X-PAYPAL-ORDER: <order ID>` | PayPal REST API |
| UPI | `X-UPI-REFERENCE: <tx ref>` | Razorpay / Cashfree API |
| Credits | `X-CREDITS: <account:sig>` | Internal credit store |

---

## What the API owner gets

### 1. Multi-protocol acceptance

Accept payments from agents using any payment method — through one middleware.

```typescript
const paywall = createPaywall({
  recipient: '0xYourWallet',
  adapters: [
    mpp({ networks: ['tempo', 'stripe'] }),    // MPP agents
    x402({ network: 'base' }),                  // x402 agents
    visa(),                                      // Visa agents
    stripe({ secretKey: '...' }),               // Stripe agents
    credits({ store }),                         // Prepaid credit agents
  ],
});
```

### 2. Intelligent routing (14 strategies)

When an agent sends payment, the middleware detects which adapter matches and verifies it. When configured with the Smart Router, it selects the optimal verification path:

```typescript
import { createRouter } from '@openagentpay/router';

const router = createRouter({
  adapters: [
    { adapter: mpp({ ... }), costPerTransaction: '0.001' },
    { adapter: x402({ ... }), costPerTransaction: '0.001' },
    { adapter: stripe({ ... }), costPerTransaction: '0.30', costPercentage: 2.9, minimumAmount: '0.50' },
  ],
  strategy: 'smart',
  cascade: true,
});
```

| Strategy | What it does |
|----------|-------------|
| `priority` | Static priority order |
| `lowest-cost` | Cheapest adapter for the amount |
| `highest-success` | Best recent success rate |
| `lowest-latency` | Fastest response time |
| `round-robin` | Even distribution |
| `weighted` | Probabilistic (A/B testing) |
| `smart` | Composite: success × 0.5 + cost × 0.3 + latency × 0.2 |
| `adaptive` | Multi-armed bandit (10% exploration, 90% exploit) |
| `conditional` | Rule-based if/else routing |
| `amount-tiered` | Different strategy per amount range |
| `geo-aware` | Region-based preferences |
| `time-aware` | Time-of-day optimization |
| `failover-only` | Primary/secondary with recovery probes |
| `custom` | User-defined scoring function |

### 3. Cascade failover

If the first matching adapter's verification fails, the middleware automatically tries the next one. Returns 402 only after all adapters have been tried.

### 4. Subscriptions

Agents that call your API repeatedly can subscribe instead of paying per call.

```typescript
const paywall = createPaywall({
  recipient: '0x...',
  adapters: [mpp({ ... })],
  subscriptions: {
    plans: [
      { id: 'daily-unlimited', amount: '5.00', currency: 'USDC', period: 'day', calls: 'unlimited' },
    ],
  },
});

app.use(paywall.routes());
// POST /openagentpay/subscribe    — pay + activate (payment verified via adapter)
// GET  /openagentpay/subscription — check status
// POST /openagentpay/unsubscribe  — cancel
```

Active subscriptions use `X-SUBSCRIPTION` header — no per-call payment.

### 5. Receipts and observability

Every payment generates a structured `AgentPaymentReceipt` — same schema regardless of payment method.

```typescript
paywall.on('payment:received', (receipt) => {
  console.log(`${receipt.payment.method}: $${receipt.payment.amount} from ${receipt.payer.identifier}`);
});
```

Store, query, and export receipts:

```typescript
import { createReceiptStore } from '@openagentpay/receipts';
const store = createReceiptStore({ type: 'file', path: './receipts' });
const csv = await store.export({ format: 'csv' });
```

OpenTelemetry integration:

```typescript
import { createPaymentTracer, createPaymentMetrics } from '@openagentpay/otel-exporter';
paywall.on('payment:received', (receipt) => {
  createPaymentTracer().recordPayment(receipt);
  createPaymentMetrics().recordPayment(receipt);
});
```

### 6. Dynamic pricing

```typescript
// Static
app.get('/api/search', paywall({ price: '0.01' }), handler);

// Dynamic — price as a function of the request
app.post('/api/process', paywall((req) => ({
  price: (0.01 * req.body.pages).toFixed(3),
  description: `Process ${req.body.pages} pages`,
})), handler);
```

---

## All 18 packages

### Server-side (API owner installs)

| Package | What it does |
|---------|-------------|
| `core` | Types, schemas, builders, parsers, 10 error classes. Zero deps. Foundation for both sides. |
| `router` | 14 routing strategies, health tracking, cost estimation, cascade failover. |
| `server-express` | Express paywall middleware + subscription endpoints. |
| `server-hono` | Hono paywall middleware + subscription endpoints. |
| `adapter-mpp` | MPP protocol — Tempo, Stripe SPT, Lightning. Sessions. |
| `adapter-x402` | x402 protocol — USDC on Base via EIP-3009 + facilitator. |
| `adapter-visa` | Visa MCP + AgentCard virtual debit cards. |
| `adapter-stripe` | Stripe PaymentIntents + credit bridge via Checkout. |
| `adapter-paypal` | PayPal Orders + credit bridge. OAuth2. |
| `adapter-upi` | UPI AutoPay mandates via Razorpay/Cashfree. |
| `adapter-credits` | Prepaid balance with atomic deductions. |
| `adapter-mock` | Simulated payments for development/testing. |
| `receipts` | Receipt storage (memory/file), query, CSV/JSON export. |
| `mcp` | `paidTool()` — wrap MCP tool handlers with payment verification. |
| `vault` | Credential vault — encrypted storage for agent payment credentials. |
| `otel-exporter` | OpenTelemetry spans + metrics. |

### Agent-side (agent installs)

| Package | What it does |
|---------|-------------|
| `client` | `withPayment(fetch)` — parses unified 402, selects method, pays, retries, collects receipts. |
| `policy` | Spend governance engine — 11 rules, budgets, domain globs. Used by client internally. |
| `mcp` | `withMCPPayment()` — wraps MCP client to handle paid tool invocations transparently. |
| Wallet adapters | Same adapter packages as server — `adapter-mpp`, `adapter-x402`, etc. provide client-side `pay()` + `supports()`. |

---

## Payment method comparison

| Method | Min Amount | Per-Call Fee | Settlement | Agent wallet adapter |
|--------|-----------|-------------|-----------|---------------------|
| MPP (Tempo) | ~$0.001 | ~$0.001 | Instant | `@openagentpay/adapter-mpp` |
| x402 (USDC) | ~$0.001 | ~$0.001 | ~200ms | `@openagentpay/adapter-x402` |
| Visa MCP | ~$1.00 | Card rates | 1-3 days | `@openagentpay/adapter-visa` |
| AgentCard | $1.00 | Card rates | 1-3 days | `@openagentpay/adapter-visa` |
| Stripe | $0.50 | 2.9%+$0.30 | 2-7 days | `@openagentpay/adapter-stripe` |
| PayPal | ~$1.00 | 3.49%+$0.49 | 1-3 days | `@openagentpay/adapter-paypal` |
| UPI | Rs 1 | ~0% | T+1 | `@openagentpay/adapter-upi` |
| Credits | $0.001 | $0 | Instant | `@openagentpay/adapter-credits` |

---

## MCP tool monetization

```typescript
// Server: charge per MCP tool invocation
import { paidTool } from '@openagentpay/mcp';

const search = paidTool({
  price: '0.01',
  adapters: [mpp({ ... }), x402({ ... })],
  recipient: '0x...',
}, async (params) => {
  return { results: await engine.search(params.query) };
});
```

---

## Getting paid

OpenAgentPay is not a payment processor. Money flows directly from agent to API owner through the payment rail:

- **x402**: USDC → directly to your wallet on Base
- **MPP**: settlement via Tempo/Stripe depending on network
- **Stripe/PayPal**: settlement to your Stripe/PayPal account
- **UPI**: settlement to your bank account
- **Credits**: you already hold the money (prepaid)

See [Getting Paid Guide](./docs/getting-paid.md) and [Fiat Payment Methods](./docs/fiat-payment-methods.md).

---

## Examples

```bash
cd examples/paid-weather-api && pnpm start    # API with pricing + subscriptions
cd examples/agent-client && pnpm start         # Agent with policy engine (optional client)
cd examples/end-to-end-demo && pnpm start      # Full flow in one script
```

---

## Documentation

| Guide | Covers |
|-------|--------|
| [Getting Started](./docs/getting-started.md) | Install, server setup, optional client setup |
| [Concepts](./docs/concepts.md) | 402 flow, adapters, policy, receipts |
| [Smart Router](./docs/smart-router.md) | 14 strategies, health tracking, cascade, cost estimation |
| [Server SDK](./docs/server-sdk.md) | Middleware, pricing, subscriptions, events |
| [Client SDK](./docs/client-sdk.md) | Optional agent-side client for policy + multi-method |
| [Payment Adapters](./docs/payment-adapters.md) | All 8 adapters + custom adapter guide |
| [MPP Integration](./docs/mpp-integration.md) | MPP protocol, sessions, Tempo/Stripe/Lightning |
| [Visa Integration](./docs/visa-integration.md) | Visa MCP, AgentCard |
| [Fiat Methods](./docs/fiat-payment-methods.md) | Stripe/PayPal/UPI architecture + fees |
| [Getting Paid](./docs/getting-paid.md) | Wallet setup, fiat conversion, tax |
| [Policy Engine](./docs/policy-engine.md) | 11 rules, domain globs, spend tracking |
| [Receipts](./docs/receipts.md) | Storage, querying, export |
| [MCP Tools](./docs/mcp-integration.md) | Paid MCP tools |

## Specifications

- [402 Response Format](./specs/402-response.md) — machine-readable pricing
- [Agent Payment Receipt](./specs/receipt.md) — structured audit record

---

## Development

```bash
git clone https://github.com/alokemajumder/OpenAgentPay.git
cd OpenAgentPay
pnpm install && pnpm build && pnpm test
```

18 packages · 106 TypeScript files · 21,000+ lines
TypeScript · Turborepo · pnpm · Biome · Vitest · Apache 2.0

## Contributing

[CONTRIBUTING.md](./CONTRIBUTING.md) · [SECURITY.md](./SECURITY.md) · [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
