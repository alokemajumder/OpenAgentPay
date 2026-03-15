# Getting Started with OpenAgentPay

## Prerequisites

- Node.js 20+
- pnpm (recommended) or npm

## Installation

```bash
# Server-side (API provider)
pnpm add @openagentpay/server-express @openagentpay/adapter-mock @openagentpay/core

# Client-side (AI agent)
pnpm add @openagentpay/client @openagentpay/adapter-mock @openagentpay/core

# For real payments
pnpm add @openagentpay/adapter-x402

# For prepaid credits
pnpm add @openagentpay/adapter-credits

# For MCP tools
pnpm add @openagentpay/mcp

# For Hono (instead of Express)
pnpm add @openagentpay/server-hono
```

## Quick Start: Accept Agent Payments (Server)

### 1. Add paywall to your Express API

```typescript
import express from 'express';
import { createPaywall } from '@openagentpay/server-express';
import { mock } from '@openagentpay/adapter-mock';

const app = express();
app.use(express.json());

const paywall = createPaywall({
  recipient: '0x0000000000000000000000000000000000000000',
  adapters: [mock()], // Use x402() for real payments
});

// One line to monetize any endpoint
app.get('/api/search', paywall({ price: '0.01' }), (req, res) => {
  res.json({ results: ['result1', 'result2'] });
});

// Dynamic pricing
app.post('/api/process', paywall((req) => ({
  price: (0.01 * req.body.pages).toFixed(3),
  description: `Process ${req.body.pages} pages`,
})), (req, res) => {
  res.json({ processed: true });
});

// Free endpoint (no paywall)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(3000, () => {
  console.log('Paid API running on http://localhost:3000');
});
```

### 2. Test it

```bash
# Without payment — gets 402
curl http://localhost:3000/api/search
# → 402 Payment Required
# → { "type": "payment_required", "pricing": { "amount": "0.01" }, ... }

# With mock payment — gets response
curl -H "X-PAYMENT: mock:test123" http://localhost:3000/api/search
# → 200 OK
# → { "results": ["result1", "result2"] }
```

## Quick Start: Agent That Pays (Client)

```typescript
import { withPayment } from '@openagentpay/client';
import { mockWallet } from '@openagentpay/adapter-mock';

const paidFetch = withPayment(fetch, {
  wallet: mockWallet(),
  policy: {
    maxPerRequest: '1.00',
    maxPerDay: '50.00',
    allowedDomains: ['localhost', 'api.example.com'],
  },
  onReceipt: (receipt) => {
    console.log(`Paid ${receipt.payment.amount} for ${receipt.request.url}`);
  },
});

// Use like normal fetch — payments happen automatically
const response = await paidFetch('http://localhost:3000/api/search');
const data = await response.json();
console.log(data); // { results: ["result1", "result2"] }
```

## Adding Subscriptions

### Server

```typescript
const paywall = createPaywall({
  recipient: '0x...',
  adapters: [mock()],
  subscriptions: {
    plans: [
      {
        id: 'daily-unlimited',
        amount: '5.00',
        currency: 'USDC',
        period: 'day',
        calls: 'unlimited',
      },
    ],
  },
});

// Register subscription management endpoints
app.use(paywall.routes());
// Creates: POST /openagentpay/subscribe
//          GET  /openagentpay/subscription
//          POST /openagentpay/unsubscribe
```

### Agent subscribes

```bash
# Subscribe
curl -X POST http://localhost:3000/openagentpay/subscribe \
  -H "Content-Type: application/json" \
  -d '{"plan_id": "daily-unlimited", "payer_identifier": "agent-1"}'
# → { "token": "abc-123", "expires_at": "...", "calls_remaining": "unlimited" }

# Use subscription (no per-call payment needed)
curl -H "X-SUBSCRIPTION: abc-123" http://localhost:3000/api/search
# → 200 OK
```

## Real Payments (x402 / USDC)

```typescript
import { x402 } from '@openagentpay/adapter-x402';
import { x402Wallet } from '@openagentpay/adapter-x402';

// Server
const paywall = createPaywall({
  recipient: '0xYourWalletAddress',
  adapters: [x402({ network: 'base-sepolia' })],
});

// Client
const paidFetch = withPayment(fetch, {
  wallet: x402Wallet({
    privateKey: process.env.AGENT_WALLET_KEY,
    network: 'base-sepolia',
  }),
});
```

## Paid MCP Tools

```typescript
import { paidTool, withMCPPayment } from '@openagentpay/mcp';
import { mock } from '@openagentpay/adapter-mock';

// Server: create a paid MCP tool
const searchTool = paidTool({
  price: '0.01',
  currency: 'USDC',
  adapters: [mock()],
  recipient: '0x...',
}, async (params) => {
  return { results: await search(params.query) };
});

// Client: wrap MCP client to handle payments
const client = withMCPPayment(mcpClient, {
  wallet: mockWallet(),
  policy: { maxPerCall: '0.10' },
});
```

## Next Steps

- [Concepts](./concepts.md) — understand the 402 flow, receipts, and policy engine
- [Server SDK Guide](./server-sdk.md) — detailed server configuration
- [Client SDK Guide](./client-sdk.md) — agent configuration and policy
- [Payment Adapters](./payment-adapters.md) — mock, credits, x402
- [Receipts](./receipts.md) — storage, query, and export
- [MCP Integration](./mcp-integration.md) — paid MCP tools
