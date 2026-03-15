# OpenAgentPay

**Stripe for AI Agents — Open-Source Payment SDK**

AI agents discover prices, pay per call, and get receipts. API providers earn instantly. No signup, no API keys, no invoices.

---

## The Problem

AI agents can't pay for things. Every paid API requires a human to create an account, manage API keys, and reconcile invoices. This doesn't scale when thousands of agents call thousands of APIs.

## The Solution

OpenAgentPay makes API payments as simple as HTTP:

```
Agent → GET /api/search?q=test
Server → 402 Payment Required (machine-readable pricing)
Agent → pays $0.01 USDC (or credits, or mock for testing)
Server → 200 OK (response + receipt)
```

No signup. No API key. No subscription. Just pay and use.

---

## Quick Start

### Server: Accept Agent Payments (3 lines)

```typescript
import express from 'express';
import { createPaywall } from '@openagentpay/server-express';
import { mock } from '@openagentpay/adapter-mock';

const app = express();
const paywall = createPaywall({
  recipient: '0x0000000000000000000000000000000000000000',
  adapters: [mock()],
});

// One line to monetize any endpoint
app.get('/api/search', paywall({ price: '0.01' }), (req, res) => {
  res.json({ results: ['result1', 'result2'] });
});

app.listen(3000);
```

### Client: Agent That Pays (3 lines)

```typescript
import { withPayment } from '@openagentpay/client';
import { mockWallet } from '@openagentpay/adapter-mock';

const paidFetch = withPayment(fetch, {
  wallet: mockWallet(),
  policy: { maxPerRequest: '1.00', maxPerDay: '50.00' },
});

// Identical to fetch — but handles 402 payments automatically
const response = await paidFetch('http://localhost:3000/api/search?q=test');
const data = await response.json();
// Paid $0.01, got results, receipt stored
```

### What Happens

```bash
# Without payment
curl http://localhost:3000/api/search?q=test
# → 402 Payment Required
# → { "type": "payment_required", "pricing": { "amount": "0.01", "currency": "USDC" }, ... }

# With payment
curl -H "X-PAYMENT: mock:test123" http://localhost:3000/api/search?q=test
# → 200 OK
# → { "results": ["result1", "result2"] }
```

---

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| [`@openagentpay/core`](./packages/core) | Types, schemas, builders | In Progress |
| [`@openagentpay/adapter-mock`](./packages/adapter-mock) | Mock payments for testing | In Progress |
| [`@openagentpay/server-express`](./packages/server-express) | Express paywall middleware | In Progress |
| `@openagentpay/client` | Agent-side HTTP client with auto-402 | Planned |
| `@openagentpay/policy` | Spend governance engine | Planned |
| `@openagentpay/adapter-credits` | Prepaid credit system | Planned |
| `@openagentpay/adapter-x402` | x402 stablecoin payments (USDC) | Planned |
| `@openagentpay/receipts` | Receipt storage and query | Planned |
| `@openagentpay/mcp` | Paid MCP tool adapter | Planned |
| `@openagentpay/server-hono` | Hono paywall middleware | Planned |

---

## Features

### For API Providers
- **One-line paywall** — add `paywall({ price: '0.01' })` to any route
- **Dynamic pricing** — price as a function of the request
- **Subscriptions** — hourly, daily, monthly plans with auto-renewal
- **Multiple payment methods** — x402 (stablecoin), credits, mock (testing)
- **Automatic receipts** — every payment generates a structured receipt
- **Instant settlement** — get paid in USDC, no waiting for invoices

### For AI Agents
- **Auto-discovery** — parse 402 responses to learn pricing
- **Auto-payment** — transparent payment handling in HTTP client
- **Policy engine** — spend limits, domain allowlists, approval thresholds
- **Auto-subscribe** — switch to subscriptions when per-call is more expensive
- **Receipts** — full audit trail of every payment decision

### For the Ecosystem
- **Open 402 response standard** — machine-readable pricing for any API
- **Open receipt standard** — structured audit trail for agent commerce
- **Protocol-agnostic** — x402 today, any payment method tomorrow

---

## How It Works

### The 402 Flow

```
┌──────────┐                          ┌──────────┐
│ AI Agent │                          │ Paid API │
└────┬─────┘                          └────┬─────┘
     │                                     │
     │  GET /api/search?q=test             │
     │────────────────────────────────────►│
     │                                     │
     │  402 Payment Required               │
     │  {                                  │
     │    pricing: { amount: "0.01" },     │
     │    subscriptions: [...],            │
     │    methods: [{ type: "x402" }, ...] │
     │  }                                  │
     │◄────────────────────────────────────│
     │                                     │
     │  Policy: $0.01 ≤ max? ✓            │
     │  Pay: sign USDC transfer            │
     │                                     │
     │  GET /api/search?q=test             │
     │  X-PAYMENT: <signed proof>          │
     │────────────────────────────────────►│
     │                                     │
     │  Verify payment ✓                   │
     │  Execute handler                    │
     │                                     │
     │  200 OK { results: [...] }          │
     │  X-RECEIPT: <receipt-id>            │
     │◄────────────────────────────────────│
```

### Agent Subscriptions

When per-call payments get expensive, agents auto-subscribe:

```typescript
// Agent detects: 800 calls/day × $0.01 = $8.00
// Daily subscription available: $5.00 unlimited
// Auto-subscribes, saves 37%
```

### Policy Engine

Agents don't spend blindly. The policy engine prevents:
- Spending more than $X per request or per day
- Paying unauthorized domains
- Exceeding budget without human approval

```typescript
policy: {
  maxPerRequest: '1.00',     // never pay more than $1 per call
  maxPerDay: '50.00',        // daily budget cap
  allowedDomains: ['*.trusted.dev'],
  approvalThreshold: '5.00', // ask human above $5
}
```

---

## Architecture

```
openagentpay/
├── packages/
│   ├── core/              # Types, schemas, builders (zero deps)
│   ├── adapter-mock/      # Test/dev payment adapter
│   ├── adapter-credits/   # Prepaid balance system
│   ├── adapter-x402/      # Real stablecoin payments
│   ├── server-express/    # Express middleware
│   ├── server-hono/       # Hono middleware
│   ├── client/            # Agent HTTP client
│   ├── policy/            # Spend governance
│   ├── receipts/          # Receipt storage
│   └── mcp/               # MCP tool adapter
├── examples/
│   ├── paid-weather-api/  # Server example
│   └── agent-client/      # Client example
└── specs/
    ├── 402-response.md    # 402 format specification
    └── receipt.md         # Receipt schema specification
```

---

## Payment Methods

| Method | Type | Settlement | Use Case |
|--------|------|-----------|----------|
| **Mock** | Testing | Instant (simulated) | Development, CI, demos |
| **Credits** | Prepaid balance | Instant | Predictable budgets |
| **x402 (USDC)** | Stablecoin | ~2 seconds (Base L2) | Production agent payments |

---

## Development

```bash
# Clone
git clone https://github.com/OpenAgentPay/openagentpay.git
cd openagentpay

# Install
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Run the example
cd examples/paid-weather-api
pnpm start
```

---

## Roadmap

See [SCOPE.md](./SCOPE.md) for detailed scope, progress tracking, and architecture decisions.

- **Phase 1** (current): Core types + mock adapter + Express middleware + weather API example
- **Phase 2**: Client SDK + policy engine + credits adapter
- **Phase 3**: x402 real payments + subscriptions + receipts
- **Phase 4**: Hono middleware + MCP integration
- **Phase 5**: Python SDK + OpenTelemetry + mainnet launch

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## Security

See [SECURITY.md](./SECURITY.md) for our responsible disclosure policy.

## License

[Apache 2.0](./LICENSE)
