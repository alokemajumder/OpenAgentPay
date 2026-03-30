# MPP Integration (Machine Payments Protocol)

## What is MPP?

MPP (Machine Payments Protocol) is the open standard for machine-to-machine payments, co-authored by Stripe and Tempo. It standardizes HTTP 402 for automated agent-to-service payments.

Partners: Anthropic, OpenAI, DoorDash, Mastercard, Nubank, Revolut, Shopify, Standard Chartered, Visa, Ramp, Lightspark.

MPP and OpenAgentPay are complementary — MPP defines the wire protocol, OpenAgentPay adds the developer toolkit (policy engine, receipts, MCP adapter, multi-method support).

## How MPP Works

MPP uses a Challenge-Credential-Receipt pattern over HTTP 402:

```
Agent  →  GET /api/data
Server →  402 + Challenge { challengeId, amount, networks: ['tempo', 'stripe'] }
Agent  →  Pays on selected network
Agent  →  GET /api/data + Authorization: <Credential>
Server →  200 + Receipt
```

### Payment Networks

MPP supports multiple payment rails:
- **Tempo** — stablecoin payments on the Tempo blockchain (backed by Stripe + Paradigm)
- **Stripe** — card payments via Shared Payment Tokens (SPTs)
- **Lightning** — Bitcoin micropayments via BOLT11 invoices (via Lightspark)

## Installation

```bash
pnpm add @openagentpay/adapter-mpp @openagentpay/core
```

## Server: Accept MPP Payments

```typescript
import { createPaywall } from '@openagentpay/server-express';
import { mpp } from '@openagentpay/adapter-mpp';

const paywall = createPaywall({
  recipient: '0xYourAddress',
  adapters: [mpp({
    networks: ['tempo', 'stripe'],
    secretKey: process.env.MPP_SECRET_KEY,
  })],
});

app.get('/api/data', paywall({ price: '0.01' }), handler);
```

The adapter issues MPP Challenges in the 402 response and verifies Credentials on retry.

## Client: Agent Pays via MPP

```typescript
import { withPayment } from '@openagentpay/client';
import { mppWallet } from '@openagentpay/adapter-mpp';

const paidFetch = withPayment(fetch, {
  wallet: mppWallet({
    network: 'tempo',
    privateKey: process.env.AGENT_WALLET_KEY,
  }),
  policy: { maxPerRequest: '1.00', maxPerDay: '50.00' },
});

const data = await paidFetch('https://api.example.com/data').then(r => r.json());
```

## MPP Sessions — "OAuth for Money"

Sessions are MPP's key innovation. Instead of paying per-call, the agent authorizes a spending limit upfront. Thousands of micro-transactions are aggregated into a single settlement.

```typescript
import { MPPSessionManager } from '@openagentpay/adapter-mpp';

const sessions = new MPPSessionManager({
  network: 'tempo',
  privateKey: process.env.AGENT_WALLET_KEY,
});

// Agent authorizes $10 for this session
const session = await sessions.createSession({
  maxAmount: '10.00',
  currency: 'USD',
  network: 'tempo',
  recipient: '0xAPIProvider',
  duration: '1h',
});

// Per-call charges against the session (no per-call auth)
await sessions.chargeSession(session.sessionId, '0.01');
await sessions.chargeSession(session.sessionId, '0.01');
// ...repeat thousands of times...

// Close session, refund unused balance
await sessions.closeSession(session.sessionId);
```

## Streaming Payments

For long-running requests (LLM token generation, data processing), streaming payments charge incrementally against a session:

```typescript
import { mpp, MPPAdapter } from '@openagentpay/adapter-mpp';

const adapter = mpp({
  networks: ['tempo', 'stripe'],
  sessionsSupported: true,
  streamingSupported: true,
});

// Start a stream against an active session
const stream = await adapter.startStream({
  sessionId: session.sessionId,
  amountPerChunk: '0.0001',
  currency: 'USD',
});

// Charge per chunk/token
for await (const chunk of generateTokens()) {
  await adapter.chargeStreamChunk(stream.streamId, '0.0001');
  yield chunk;
}

// End the stream
const meter = await adapter.endStream(stream.streamId);
// meter.chunksCharged, meter.totalCharged
```

## IETF Payment Auth Scheme

OpenAgentPay's MPP adapter supports the IETF `Payment` HTTP auth scheme per `draft-ryan-httpauth-payment`:

```typescript
// Server generates WWW-Authenticate header
const wwwAuth = adapter.buildWWWAuthenticate({
  recipient: '0x...',
  amount: '0.01',
  currency: 'USD',
  resource: '/api/data',
});
// → "Payment realm="0x...", challenge="base64...", networks="tempo,stripe", sessions=true, streaming=true"

// Receipt in response header
const receiptHeader = MPPAdapter.buildReceiptHeader({
  id: 'mpp_receipt_123',
  amount: '0.01',
  currency: 'USD',
  network: 'tempo',
  status: 'settled',
  ref: '0xabc...',
});
// → "Payment base64..."
```

## Session-First Wallet

The MPP wallet can prefer sessions over per-call payments when available:

```typescript
import { mppWallet } from '@openagentpay/adapter-mpp';

const wallet = mppWallet({
  network: 'tempo',
  tempoPrivateKey: process.env.KEY,
  preferSessions: true,            // auto-create sessions when available
  defaultSessionBudget: '10.00',   // $10 per session
  defaultSessionDuration: '1h',    // 1 hour sessions
});

// When paying, wallet automatically creates/reuses sessions
// Falls back to per-call payment if sessions unavailable
```

## MPP + OpenAgentPay Advantages

Using MPP through OpenAgentPay gives you:
- **Policy engine** — spend limits, domain rules, approval thresholds (MPP alone has none)
- **Receipts** — structured audit trail with query/export (MPP receipts are minimal)
- **Multi-method** — fall back to x402, credits, Stripe, PayPal if MPP isn't available
- **MCP adapter** — paid MCP tools work with MPP payments
- **Subscriptions** — OpenAgentPay's subscription system works alongside MPP sessions

## Combining with Other Adapters

```typescript
const paywall = createPaywall({
  recipient: '0x...',
  adapters: [
    mpp({ networks: ['tempo', 'stripe'] }),  // try MPP first
    x402({ network: 'base' }),                // fallback to x402
    credits({ store }),                       // fallback to credits
  ],
});
```

The 402 response advertises all available methods. The agent picks the best one.
