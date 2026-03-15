# Getting Started

## Prerequisites

- Node.js 20+
- pnpm

## Install what you need

```bash
# If you're an API provider accepting agent payments
pnpm add @openagentpay/server-express @openagentpay/adapter-mock @openagentpay/core

# If you're building an agent that pays for APIs
pnpm add @openagentpay/client @openagentpay/adapter-mock @openagentpay/core

# Additional adapters (pick what you need)
pnpm add @openagentpay/adapter-x402       # real USDC payments on Base
pnpm add @openagentpay/adapter-credits    # prepaid credit system
pnpm add @openagentpay/policy             # standalone spend governance
pnpm add @openagentpay/receipts           # receipt storage + query
pnpm add @openagentpay/mcp               # paid MCP tools
pnpm add @openagentpay/server-hono        # Hono instead of Express
pnpm add @openagentpay/otel-exporter      # OpenTelemetry integration
```

## Server side: accept payments

### 1. Create a paywall

```typescript
import express from 'express';
import { createPaywall } from '@openagentpay/server-express';
import { mock } from '@openagentpay/adapter-mock';

const app = express();
app.use(express.json());

const paywall = createPaywall({
  recipient: '0xYourWalletAddress',
  adapters: [mock()],
});
```

### 2. Add it to routes

```typescript
// Static price
app.get('/api/search', paywall({ price: '0.01' }), (req, res) => {
  res.json({ results: ['data1', 'data2'] });
});

// Dynamic price — function receives the request
app.post('/api/process', paywall((req) => ({
  price: (0.01 * req.body.pages).toFixed(3),
  description: `Process ${req.body.pages} pages`,
})), (req, res) => {
  res.json({ processed: true });
});

// Free endpoint — no paywall
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.listen(3000);
```

### 3. Test it

```bash
curl http://localhost:3000/api/search
# → 402 Payment Required
# → { "type": "payment_required", "pricing": { "amount": "0.01", "currency": "USDC", "unit": "per_request" }, "methods": [...] }

curl -H "X-PAYMENT: mock:test123" http://localhost:3000/api/search
# → 200 OK
# → { "results": ["data1", "data2"] }
```

## Agent side: pay for APIs

```typescript
import { withPayment } from '@openagentpay/client';
import { mockWallet } from '@openagentpay/adapter-mock';

const paidFetch = withPayment(fetch, {
  wallet: mockWallet(),
  policy: {
    maxPerRequest: '1.00',
    maxPerDay: '50.00',
    allowedDomains: ['localhost'],
  },
  onReceipt: (receipt) => {
    console.log(`Paid ${receipt.payment.amount} for ${receipt.request.url}`);
  },
});

const response = await paidFetch('http://localhost:3000/api/search');
const data = await response.json();
```

`withPayment` wraps native `fetch`. When a server returns 402, the wrapper parses the pricing, evaluates the policy, pays via the wallet adapter, retries the request with the payment proof in the `X-PAYMENT` header, and returns the final response. Your code just calls `paidFetch(url)`.

## Switching to real payments

Replace `mock()` with `x402()` when you're ready for production:

```typescript
import { x402, x402Wallet } from '@openagentpay/adapter-x402';

// Server
const paywall = createPaywall({
  recipient: '0xYourWalletAddress',
  adapters: [x402({ network: 'base-sepolia' })],  // testnet first
});

// Client
const paidFetch = withPayment(fetch, {
  wallet: x402Wallet({ privateKey: process.env.AGENT_WALLET_KEY!, network: 'base-sepolia' }),
});
```

## Next steps

- [Concepts](./concepts.md) — the 402 flow, receipts, and policy engine explained
- [Server SDK](./server-sdk.md) — subscriptions, events, multiple adapters
- [Client SDK](./client-sdk.md) — policy configuration, spend tracking
- [Payment Adapters](./payment-adapters.md) — mock, credits, x402
- [Policy Engine](./policy-engine.md) — all 11 rules, domain matching, spend queries
- [Receipts](./receipts.md) — storage, querying, CSV/JSON export
- [MCP Integration](./mcp-integration.md) — paid MCP tools
