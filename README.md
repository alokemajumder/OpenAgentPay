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
        ┌───────┬──────┬───────────┼───────────┬──────┬───────┐
        │       │      │           │           │      │       │
     ┌──▼──┐ ┌─▼──┐ ┌─▼───┐ ┌────▼───┐ ┌───▼──┐ ┌─▼────┐ ┌▼──────┐
     │ MPP │ │x402│ │Solna│ │  Visa  │ │Stripe│ │Lghtn.│ │Credits│
     │     │ │USDC│ │ SPL │ │AgentCrd│ │PayPal│ │BOLT11│ │ Mock  │
     │Tempo│ │Base│ │     │ │  MCP   │ │ UPI  │ │      │ │       │
     └─────┘ └────┘ └─────┘ └────────┘ └──────┘ └──────┘ └───────┘
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

**Payment proof headers are protocol-standard** — once the agent pays, the header it sends uses the native protocol format. The server-side adapter verifies it against the real payment processor.

| Protocol | Payment header sent by agent | Verified by |
|----------|----------------------------|-------------|
| MPP | `Authorization: MPP <credential>` | Tempo RPC / Stripe API |
| x402 | `X-PAYMENT: <base64 EIP-3009>` | x402 facilitator |
| Solana | `X-SOLANA-PAYMENT: <base64 proof>` | Solana RPC |
| Lightning | `X-LIGHTNING-PAYMENT: <base64 proof>` | LND REST API |
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
    solana({ rpcUrl: '...' }),                  // Solana SPL agents
    lightning({ nodeUrl: '...' }),              // Lightning agents
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
| `smart` | Composite: success x 0.5 + cost x 0.3 + latency x 0.2 |
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

### 5. Service discovery

Expose your API's payment capabilities so agents can discover pricing programmatically:

```typescript
import { discoveryMiddleware } from '@openagentpay/server-express';

app.use(discoveryMiddleware({
  version: '1.0',
  provider: 'My API',
  methods: ['mpp', 'x402', 'solana'],
  currencies: ['USD', 'USDC'],
  endpoints: [
    { path: '/api/search', methods: ['GET'], pricing: { amount: '0.01', currency: 'USD', unit: 'per_request' } },
  ],
  capabilities: { subscriptions: true, streaming: true, sessions: true, receipts: true },
}));
// GET /.well-known/agent-pay → machine-readable discovery document
```

### 6. Receipts and observability

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

### 7. Dynamic pricing

```typescript
// Static
app.get('/api/search', paywall({ price: '0.01' }), handler);

// Dynamic — price as a function of the request
app.post('/api/process', paywall((req) => ({
  price: (0.01 * req.body.pages).toFixed(3),
  description: `Process ${req.body.pages} pages`,
})), handler);
```

### 8. Zero-code payment proxy

Wrap any existing API with payment gating — no code changes to the upstream service:

```typescript
import { createProxy } from '@openagentpay/proxy';

const proxy = createProxy({
  upstream: 'https://internal-api.example.com',
  pricing: { amount: '0.01', currency: 'USD' },
  recipient: '0xYourWallet',
  freePaths: ['/health', '/docs/*'],
});

await proxy.start(3000);
// All requests to port 3000 now require payment (except /health, /docs/*)
```

### 9. Tax awareness

Automatic tax calculation and reporting for agent transactions:

```typescript
import { createCalculator, createReporter } from '@openagentpay/tax';

const tax = createCalculator({ defaultJurisdiction: 'US-CA' });
const calc = tax.calculate('10.00', 'USD', 'stripe', 'US-CA');
// { grossAmount: '10.00', taxAmount: '0.73', netAmount: '10.73', taxRate: 0.0725 }

const reporter = createReporter({ defaultJurisdiction: 'US-CA' });
reporter.addTransaction(receipt);
const report = reporter.generateReport({ from: '2026-01-01', to: '2026-03-31' });
const csv = reporter.exportCSV(report);
```

---

## All 26 packages

### Core

| Package | What it does |
|---------|-------------|
| `core` | Types, schemas, builders, parsers, error classes. Zero deps. Foundation for everything. |
| `router` | 14 routing strategies, health tracking, cost estimation, cascade failover. |
| `policy` | Spend governance engine — 12 rules including identity-required, budgets, domain globs. |
| `client` | `withPayment(fetch)` — parses unified 402, selects method, pays, retries, collects receipts. |

### Server frameworks

| Package | What it does |
|---------|-------------|
| `server-express` | Express paywall middleware + subscription endpoints + service discovery. |
| `server-hono` | Hono paywall middleware + subscription endpoints + service discovery. |
| `server-cloudflare` | Cloudflare Workers paywall handler + KV receipt storage. |
| `proxy` | Zero-code reverse proxy — wrap any API with 402 payment gating. |

### Payment adapters (10)

| Package | Protocol | Networks |
|---------|----------|----------|
| `adapter-mpp` | MPP (Machine Payments Protocol) | Tempo, Stripe, Lightning. Sessions + streaming. |
| `adapter-x402` | x402 (EIP-3009) | USDC on Base / Base Sepolia. Production secp256k1 ECDSA signing. |
| `adapter-solana` | Solana SPL tokens | USDC on Solana mainnet / devnet. Ed25519 signing. |
| `adapter-lightning` | Lightning Network | BOLT11 invoices via LND REST. Preimage verification. |
| `adapter-visa` | Visa Intelligent Commerce | Visa MCP + AgentCard virtual debit cards. |
| `adapter-stripe` | Stripe | PaymentIntents + credit bridge via Checkout. |
| `adapter-paypal` | PayPal | Orders API + credit bridge. OAuth2. |
| `adapter-upi` | UPI (India) | Reserve Pay (SBMD), AutoPay mandates, QR codes, refunds, webhooks. Razorpay + Cashfree. |
| `adapter-credits` | Prepaid credits | Atomic deductions from in-memory or persistent balance. |
| `adapter-mock` | Mock | Simulated payments for development and testing. |

### Infrastructure

| Package | What it does |
|---------|-------------|
| `receipts` | Receipt storage (memory/file), query, CSV/JSON export. |
| `vault` | Credential vault + agent identity (DIDs, Ed25519 attestations, KYA profiles). |
| `otel-exporter` | OpenTelemetry spans + metrics. |
| `tax` | Tax calculator (US/EU/India/Japan/Singapore), reporter, CSV export, capital gains. |
| `cli` | CLI tool: `agentpay probe`, `pay`, `receipt`, `discover`, `simulate`. |

### Integrations

| Package | What it does |
|---------|-------------|
| `mcp` | `paidTool()` — wrap MCP tool handlers with payment verification. |
| `mcp-mpp` | MCP-to-MPP bridge — discover and pay for MCP tools via MPP protocol. |
| `razorpay-mcp` | Razorpay MCP server client — 48+ payment tools via JSON-RPC 2.0. |

---

## Payment method comparison

| Method | Min Amount | Per-Call Fee | Settlement | Agent wallet adapter |
|--------|-----------|-------------|-----------|---------------------|
| MPP (Tempo) | ~$0.001 | ~$0.001 | Instant | `@openagentpay/adapter-mpp` |
| x402 (USDC) | ~$0.001 | ~$0.001 | ~200ms | `@openagentpay/adapter-x402` |
| Solana (SPL) | ~$0.001 | ~$0.001 | ~400ms | `@openagentpay/adapter-solana` |
| Lightning | ~1 sat | ~1 sat | Instant | `@openagentpay/adapter-lightning` |
| Visa MCP | ~$1.00 | Card rates | 1-3 days | `@openagentpay/adapter-visa` |
| AgentCard | $1.00 | Card rates | 1-3 days | `@openagentpay/adapter-visa` |
| Stripe | $0.50 | 2.9%+$0.30 | 2-7 days | `@openagentpay/adapter-stripe` |
| PayPal | ~$1.00 | 3.49%+$0.49 | 1-3 days | `@openagentpay/adapter-paypal` |
| UPI | Rs 1 | ~0% | T+1 | `@openagentpay/adapter-upi` |
| UPI Reserve Pay | Rs 1 | ~0% | T+1 | `@openagentpay/adapter-upi` |
| Credits | $0.001 | $0 | Instant | `@openagentpay/adapter-credits` |

---

## UPI Reserve Pay (agentic payments)

OpenAgentPay supports NPCI's UPI Reserve Pay (SBMD — Single Block Multi Debit), the UPI-native framework for AI agent payments:

```typescript
import { UPIReservePayManager } from '@openagentpay/adapter-upi';

const reservePay = new UPIReservePayManager({
  gateway: 'razorpay',
  apiKey: 'rzp_live_...',
  apiSecret: 'secret_...',
});

// Agent authorizes a Rs 5,000 spending limit (90-day max)
const block = await reservePay.createBlock({
  payerIdentifier: 'agent-1',
  amount: 500_000,       // Rs 5,000 in paise
  description: 'API usage budget',
  expiryDays: 30,
});
// → { blockId, authUrl, expiresAt }

// After user authorizes via UPI app, debit freely without PIN/OTP
const debit = await reservePay.executeDebit(block.blockId, 1000, 'API call');
// → { transactionId, amount: 1000, remainingAmount: 499000 }
```

Razorpay MCP server integration for AI agent frameworks:

```typescript
import { createRazorpayMCP } from '@openagentpay/razorpay-mcp';

const rzp = createRazorpayMCP({
  apiKeyId: 'rzp_live_...',
  apiKeySecret: 'secret_...',
});

// Use Razorpay's 48+ MCP tools
const link = await rzp.tools.createPaymentLink({
  amount: 50000, currency: 'INR',
  description: 'API credits', upiLink: true,
});

// Verify payment
const payment = await rzp.verifyPayment('pay_...', '500.00');
```

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

Bridge MCP tools with MPP for discovery and payment:

```typescript
import { createBridge, createDiscovery } from '@openagentpay/mcp-mpp';

const bridge = createBridge({
  recipient: '0x...',
  mppConfig: { networks: ['tempo', 'stripe'] },
  defaultPricing: { amount: '0.01', currency: 'USD' },
});

bridge.registerTool('search', schema, handler, { amount: '0.02', currency: 'USD' });
const catalog = createDiscovery(bridge).describeTools();
// → JSON-LD catalog of paid tools with pricing
```

---

## Agent identity and compliance

Verifiable agent identity via DIDs and Ed25519 attestations:

```typescript
import { AgentIdentityManager } from '@openagentpay/vault';

const identity = new AgentIdentityManager({
  privateKey: '0xabc...',  // Ed25519 seed
  label: 'my-agent',
});

const did = identity.getDID();           // did:key:z6Mk...
const attestation = identity.createAttestation(
  did, 'payment-authorization',
  { maxSpend: '100.00', allowedDomains: ['api.example.com'] }
);

// KYA (Know Your Agent) compliance profile
const kya = identity.buildKYAProfile('MyAgent', 'MyCompany', ['payments', 'data-access']);
```

---

## CLI tool

```bash
# Probe an endpoint for pricing
agentpay probe https://api.example.com/data

# Discover payment capabilities
agentpay discover https://api.example.com

# Simulate 100 requests and see stats
agentpay simulate https://api.example.com/data --count 100

# Parse a receipt
agentpay receipt ./receipt.json
```

---

## Getting paid

OpenAgentPay is not a payment processor. Money flows directly from agent to API owner through the payment rail:

- **x402**: USDC to your wallet on Base
- **MPP**: settlement via Tempo/Stripe depending on network
- **Solana**: SPL tokens to your Solana address
- **Lightning**: sats to your Lightning node
- **Stripe/PayPal**: settlement to your Stripe/PayPal account
- **UPI**: settlement to your bank account (T+1 via NPCI)
- **Credits**: you already hold the money (prepaid)

See [Getting Paid Guide](./docs/getting-paid.md) and [Fiat Payment Methods](./docs/fiat-payment-methods.md).

---

## Deployment options

### Express / Node.js

```typescript
import { createPaywall } from '@openagentpay/server-express';
```

### Hono (Bun, Deno, Node.js)

```typescript
import { createPaywall } from '@openagentpay/server-hono';
```

### Cloudflare Workers

```typescript
import { createPaywallHandler } from '@openagentpay/server-cloudflare';

export default {
  fetch: createPaywallHandler({
    pricing: { amount: '0.01', currency: 'USD' },
    recipient: '0x...',
    adapters: [mpp({ ... })],
  }, {
    handler: async (request) => new Response('Premium data'),
  }),
};
```

### Zero-code proxy

```typescript
import { createProxy } from '@openagentpay/proxy';
const proxy = createProxy({ upstream: 'https://your-api.com', ... });
await proxy.start(3000);
```

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
| [Payment Adapters](./docs/payment-adapters.md) | All 10 adapters + custom adapter guide |
| [MPP Integration](./docs/mpp-integration.md) | MPP protocol, sessions, streaming, IETF Payment auth |
| [Visa Integration](./docs/visa-integration.md) | Visa MCP, AgentCard |
| [Fiat Methods](./docs/fiat-payment-methods.md) | Stripe/PayPal/UPI architecture + fees |
| [Getting Paid](./docs/getting-paid.md) | Wallet setup, fiat conversion, tax |
| [Policy Engine](./docs/policy-engine.md) | 12 rules, domain globs, identity, spend tracking |
| [Receipts](./docs/receipts.md) | Storage, querying, export |
| [MCP Tools](./docs/mcp-integration.md) | Paid MCP tools, MCP-MPP bridge |

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

26 packages · 155 TypeScript source files · 68,000+ lines · 172 tests
TypeScript · Turborepo · pnpm · Biome · Vitest · Apache 2.0

## Contributing

[CONTRIBUTING.md](./CONTRIBUTING.md) · [SECURITY.md](./SECURITY.md) · [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
