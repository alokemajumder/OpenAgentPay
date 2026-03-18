# OpenAgentPay

### Payment orchestration for the agentic internet.

OpenAgentPay is the **common aggregation layer** for machine-to-machine payments. It is not a payment processor or gateway — it's the experience and routing layer that connects AI agents to every available payment method through a single integration point.

```
                         ┌─────────────────────────┐
                         │     OpenAgentPay         │
                         │  Orchestration Layer     │
                         │                          │
   AI Agents ──────────► │  Route ─► Verify ─► Pay  │ ──────────► API Providers
   MCP Tools             │  Policy ─► Receipt       │              MCP Servers
   Services              │  Retry  ─► Fallback      │              Microservices
                         │                          │
                         └──────────┬───────────────┘
                                    │
                    ┌───────────────┼───────────────────┐
                    │               │                   │
               ┌────▼────┐   ┌─────▼─────┐   ┌────────▼────────┐
               │  Crypto  │   │   Fiat    │   │   Card/Network  │
               ├──────────┤   ├───────────┤   ├─────────────────┤
               │ x402     │   │ Stripe    │   │ Visa MCP        │
               │ MPP/Tempo│   │ PayPal    │   │ AgentCard       │
               │ Lightning│   │ UPI       │   │ Mastercard      │
               │ Credits  │   │ Razorpay  │   │                 │
               └──────────┘   └───────────┘   └─────────────────┘
```

**One SDK. Every payment method. Intelligent routing.**

---

## What OpenAgentPay does

### For agent developers

You integrate once. OpenAgentPay handles which payment method to use, how to pay, and what happens when payment fails.

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

// Your agent calls any paid API — payment is handled automatically
const data = await paidFetch('https://api.research.org/search?q=fusion').then(r => r.json());
```

The agent doesn't know or care whether the API accepts MPP, x402, Stripe, or credits. The orchestration layer figures it out from the 402 response, selects the best method, checks the policy engine, pays, and retries.

### For API providers

You add one middleware line. Your API accepts payments from any agent, through any payment method you choose to support.

```typescript
import { createPaywall } from '@openagentpay/server-express';
import { mpp } from '@openagentpay/adapter-mpp';
import { x402 } from '@openagentpay/adapter-x402';
import { credits } from '@openagentpay/adapter-credits';

const paywall = createPaywall({
  recipient: '0xYourWallet',
  adapters: [
    mpp({ networks: ['tempo', 'stripe'] }),   // MPP first
    x402({ network: 'base' }),                 // x402 fallback
    credits({ store }),                        // credits fallback
  ],
});

app.get('/api/data', paywall({ price: '0.01' }), handler);
```

The 402 response advertises all available payment methods. The agent picks the one it supports. If the first fails, the client retries with the next. You get paid no matter which rail the agent uses.

---

## Why an orchestration layer

The machine payment landscape is fragmenting fast:

| Protocol/Method | Backed By | Payment Rail | Best For |
|----------------|-----------|-------------|----------|
| **MPP** | Stripe, Tempo, Anthropic, OpenAI, Visa | Stablecoin, Cards, Lightning | Full-stack agent commerce |
| **x402** | Coinbase | USDC on Base | Direct crypto micropayments |
| **Visa MCP** | Visa | Tokenized card network | Enterprise, card-on-file |
| **AgentCard** | AgentCard.sh | Prepaid virtual debit | Quick agent setup |
| **Stripe** | Stripe | Cards, wallets, BNPL | Fiat metered billing |
| **PayPal** | PayPal | PayPal accounts | Global reach |
| **UPI** | NPCI, RBI | Bank-to-bank (India) | India, near-zero fees |
| **Lightning** | Lightspark, LND | Bitcoin L2 | Instant micropayments |

No single protocol will win. Different agents will have different wallets. Different API providers will accept different methods. Different regions will prefer different rails.

**OpenAgentPay is the common layer that makes it all work together.**

Without orchestration:
- Agent with MPP wallet can't use an x402-only API
- API accepting only Stripe can't serve an agent with USDC
- Every new payment protocol requires new integration code on both sides
- No unified spend policy across payment methods
- No unified receipts across providers

With OpenAgentPay:
- Agent integrates once, pays on any rail
- API integrates once, accepts any method
- Policy engine governs spending across all methods
- Unified receipt format regardless of payment rail
- Intelligent routing picks the cheapest/fastest method

---

## The orchestration stack

### Layer 1: Payment adapters (connectors)

Each adapter connects to a specific payment protocol or processor. Adapters implement a common interface — `detect()`, `verify()`, `pay()`, `supports()`.

| Adapter | Package | What it connects to |
|---------|---------|-------------------|
| MPP | `@openagentpay/adapter-mpp` | Machine Payments Protocol (Tempo, Stripe SPT, Lightning) |
| x402 | `@openagentpay/adapter-x402` | x402 protocol (USDC on Base via EIP-3009) |
| Visa | `@openagentpay/adapter-visa` | Visa Intelligent Commerce MCP + AgentCard |
| Stripe | `@openagentpay/adapter-stripe` | Stripe PaymentIntents + credit bridge via Checkout |
| PayPal | `@openagentpay/adapter-paypal` | PayPal Orders API + credit bridge |
| UPI | `@openagentpay/adapter-upi` | UPI AutoPay mandates via Razorpay/Cashfree |
| Credits | `@openagentpay/adapter-credits` | Internal prepaid balance system |
| Mock | `@openagentpay/adapter-mock` | Simulated payments for testing |

### Layer 2: Routing and selection

The server middleware tries adapters in declaration order. The client selects the first method its wallet supports. Future: intelligent routing based on cost, latency, success rate, and regional preference.

```typescript
// Server: declare priority order
adapters: [
  mpp({ networks: ['tempo'] }),     // cheapest for crypto-native agents
  x402({ network: 'base' }),         // direct USDC fallback
  stripe({ secretKey: '...' }),      // fiat fallback
  credits({ store }),                // prepaid balance fallback
]

// Client: wallet auto-selects from server's offered methods
wallet: mppWallet({ network: 'tempo' })
// If server offers MPP → use it. If not, try next supported method.
```

### Layer 3: Policy and governance

The policy engine evaluates every payment before execution — regardless of payment method.

```typescript
policy: {
  maxPerRequest: '1.00',
  maxPerDay: '50.00',
  maxPerProvider: '10.00',
  allowedDomains: ['*.trusted.dev'],
  blockedDomains: ['*.sketchy.io'],
  approvalThreshold: '5.00',
}
```

11 rules, strict evaluation order, rolling spend tracking. Works identically across x402, MPP, Stripe, PayPal, UPI, credits.

### Layer 4: Receipts and observability

Every payment — regardless of method — generates a standardized `AgentPaymentReceipt`. Same schema whether the agent paid with USDC, Stripe, or UPI.

```typescript
{
  payment: {
    amount: '0.01',
    currency: 'USDC',
    method: 'mpp',              // or 'x402', 'stripe', 'paypal', 'upi', 'visa', 'credits'
    transaction_hash: '0x...',
    status: 'settled'
  },
  // ... payer, payee, request, response, policy decision
}
```

Query, aggregate, export to CSV/JSON. Pipe to OpenTelemetry via `@openagentpay/otel-exporter`.

### Layer 5: MCP integration

Paid MCP tools work with any payment method through the orchestration layer.

```typescript
import { paidTool } from '@openagentpay/mcp';

const search = paidTool({
  price: '0.01',
  adapters: [mpp({ ... }), x402({ ... }), credits({ ... })],
  recipient: '0x...',
}, async (params) => ({ results: await engine.search(params.query) }));
```

---

## All 16 packages

| Package | Layer | Purpose |
|---------|-------|---------|
| `@openagentpay/core` | Foundation | Types, schemas, builders, parsers, 10 error classes. Zero deps. |
| `@openagentpay/adapter-mpp` | Connector | MPP protocol — Tempo, Stripe SPT, Lightning. Sessions support. |
| `@openagentpay/adapter-x402` | Connector | x402 protocol — USDC on Base via EIP-3009 + facilitator. |
| `@openagentpay/adapter-visa` | Connector | Visa MCP + AgentCard virtual debit cards. |
| `@openagentpay/adapter-stripe` | Connector | Stripe PaymentIntents + credit bridge via Checkout. |
| `@openagentpay/adapter-paypal` | Connector | PayPal Orders + credit bridge. OAuth2 auth. |
| `@openagentpay/adapter-upi` | Connector | UPI mandates via Razorpay/Cashfree. Near-zero fees. |
| `@openagentpay/adapter-credits` | Connector | Prepaid balance with atomic deductions. |
| `@openagentpay/adapter-mock` | Connector | Simulated payments for development. |
| `@openagentpay/server-express` | Middleware | Express paywall + subscription management. |
| `@openagentpay/server-hono` | Middleware | Hono paywall + subscription management. |
| `@openagentpay/client` | Agent SDK | `withPayment(fetch)` — auto-handles 402, routing, retry. |
| `@openagentpay/policy` | Governance | 11 spend rules. Domain globs. Rolling budget tracking. |
| `@openagentpay/receipts` | Observability | Receipt storage (memory/file), query, CSV/JSON export. |
| `@openagentpay/mcp` | Integration | Paid MCP tools — `paidTool()` server + `withMCPPayment()` client. |
| `@openagentpay/otel-exporter` | Observability | OpenTelemetry spans + metrics for payments. |

---

## Payment method comparison

| Method | Min Amount | Per-Call Fee | Settlement | Setup Required |
|--------|-----------|-------------|-----------|----------------|
| **MPP (Tempo)** | ~$0.001 | ~$0.001 | ~instant | Wallet |
| **x402 (USDC)** | ~$0.001 | ~$0.001 | ~200ms | Wallet |
| **MPP (Stripe)** | $0.50 | 2.9%+$0.30 | 2-7 days | Stripe account |
| **Visa MCP** | ~$1.00 | Card network rates | 1-3 days | Visa enrollment |
| **AgentCard** | $1.00 | Card rates | 1-3 days | AgentCard account |
| **Stripe direct** | $0.50 | 2.9%+$0.30 | 2-7 days | Saved card |
| **PayPal** | ~$1.00 | 3.49%+$0.49 | 1-3 days | Billing agreement |
| **UPI** | Rs 1 (~$0.01) | ~0% under Rs 2,000 | T+1 | UPI mandate |
| **Credits** | $0.001 | $0 | Instant | Pre-purchase |
| **Lightning** | ~$0.001 | <1% | Instant | Lightning node |

---

## The 402 flow

Every payment method works through the same HTTP 402 protocol:

```
Agent  →  GET /api/data
Server →  402 Payment Required
          {
            type: "payment_required",
            pricing: { amount: "0.01", currency: "USDC" },
            methods: [
              { type: "mpp", networks: ["tempo", "stripe"], ... },
              { type: "x402", network: "base", ... },
              { type: "credits", purchase_url: "...", ... },
              { type: "stripe", checkout_url: "...", ... }
            ],
            subscriptions: [
              { id: "daily", amount: "5.00", period: "day", calls: "unlimited" }
            ]
          }
Agent  →  [Select method → check policy → pay → retry]
Agent  →  GET /api/data + Authorization/X-PAYMENT header
Server →  200 OK + receipt
```

The orchestration layer manages method selection, policy checks, payment execution, retry with proof, and receipt generation — across all payment methods, identically.

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
| [Server SDK](./docs/server-sdk.md) | Middleware, pricing, subscriptions, events |
| [Client SDK](./docs/client-sdk.md) | withPayment, policy, spend tracking |
| [Payment Adapters](./docs/payment-adapters.md) | All 8 adapters: mock, credits, x402, Stripe, PayPal, UPI + custom |
| [MPP Integration](./docs/mpp-integration.md) | MPP protocol, Tempo, sessions, Stripe SPT |
| [Visa Integration](./docs/visa-integration.md) | Visa MCP, AgentCard virtual cards |
| [Fiat Methods](./docs/fiat-payment-methods.md) | Stripe/PayPal/UPI architecture, fees, economics |
| [Getting Paid](./docs/getting-paid.md) | Wallet setup, fiat conversion, tax, regulatory |
| [Policy Engine](./docs/policy-engine.md) | 11 rules, domain globs, spend tracking |
| [Receipts](./docs/receipts.md) | Storage, querying, export |
| [MCP Tools](./docs/mcp-integration.md) | Paid MCP tools — paidTool() + withMCPPayment() |

## Specifications

| Spec | Defines |
|------|---------|
| [402 Response Format](./specs/402-response.md) | Machine-readable pricing discovery |
| [Agent Payment Receipt](./specs/receipt.md) | Structured audit record |

---

## Development

```bash
git clone https://github.com/alokemajumder/OpenAgentPay.git
cd OpenAgentPay
pnpm install && pnpm build && pnpm test
```

TypeScript · Turborepo · pnpm · Biome · Vitest · Apache 2.0

---

## Contributing

[CONTRIBUTING.md](./CONTRIBUTING.md) · [SECURITY.md](./SECURITY.md) · [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
