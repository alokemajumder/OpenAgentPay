# Server SDK Guide

## Overview

The server SDK lets API providers accept payments from AI agents with one line of middleware per route.

## Installation

```bash
# Express
pnpm add @openagentpay/server-express @openagentpay/core

# Hono
pnpm add @openagentpay/server-hono @openagentpay/core

# Choose an adapter
pnpm add @openagentpay/adapter-mock     # for testing
pnpm add @openagentpay/adapter-x402     # for real USDC payments
pnpm add @openagentpay/adapter-credits  # for prepaid credits
```

## Basic Setup (Express)

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

app.get('/api/data', paywall({ price: '0.01' }), (req, res) => {
  res.json({ data: 'premium content' });
});

app.listen(3000);
```

## Basic Setup (Hono)

```typescript
import { Hono } from 'hono';
import { createPaywall } from '@openagentpay/server-hono';
import { mock } from '@openagentpay/adapter-mock';

const app = new Hono();

const paywall = createPaywall({
  recipient: '0xYourWalletAddress',
  adapters: [mock()],
});

app.get('/api/data', paywall({ price: '0.01' }), (c) => {
  return c.json({ data: 'premium content' });
});

export default app;
```

## Pricing

### Static Pricing

```typescript
app.get('/api/search', paywall({ price: '0.01' }), handler);
app.get('/api/premium', paywall({ price: '0.10', currency: 'USDC' }), handler);
```

### Dynamic Pricing

Price as a function of the request:

```typescript
app.post('/api/process', paywall((req) => ({
  price: (0.01 * req.body.pages).toFixed(3),
  description: `Process ${req.body.pages} pages`,
})), handler);
```

## Subscriptions

```typescript
const paywall = createPaywall({
  recipient: '0x...',
  adapters: [mock()],
  subscriptions: {
    plans: [
      {
        id: 'hourly-unlimited',
        amount: '0.50',
        currency: 'USDC',
        period: 'hour',
        calls: 'unlimited',
      },
      {
        id: 'daily-1000',
        amount: '5.00',
        currency: 'USDC',
        period: 'day',
        calls: 1000,
        rate_limit: 60,
      },
    ],
  },
});

// Register subscription management endpoints
app.use(paywall.routes());
```

This creates:
- `POST /openagentpay/subscribe` — subscribe to a plan
- `GET /openagentpay/subscription` — check subscription status
- `POST /openagentpay/unsubscribe` — cancel subscription

## Events

```typescript
paywall.on('payment:received', (receipt) => {
  console.log(`Earned ${receipt.payment.amount} ${receipt.payment.currency}`);
});

paywall.on('payment:failed', (error) => {
  console.log(`Payment failed: ${error.message}`);
});
```

## Receipt Storage

```typescript
const paywall = createPaywall({
  recipient: '0x...',
  adapters: [mock()],
  receipts: {
    emit: true,        // fire events (default)
    store: 'memory',   // or a custom ReceiptStore
  },
});
```

## Multiple Adapters

Adapters are tried in order. The first one that detects a payment handles it:

```typescript
import { x402 } from '@openagentpay/adapter-x402';
import { credits } from '@openagentpay/adapter-credits';
import { mock } from '@openagentpay/adapter-mock';

const paywall = createPaywall({
  recipient: '0x...',
  adapters: [
    x402({ network: 'base' }),      // Try x402 first
    credits({ store: creditStore }), // Then credits
    mock(),                          // Fallback to mock (dev only)
  ],
});
```

## How the 402 Response Works

When an agent calls your endpoint without payment, they get:

```json
{
  "type": "payment_required",
  "version": "1.0",
  "resource": "/api/search",
  "pricing": {
    "amount": "0.01",
    "currency": "USDC",
    "unit": "per_request"
  },
  "methods": [
    { "type": "x402", "network": "base", ... },
    { "type": "credits", "purchase_url": "...", ... }
  ],
  "subscriptions": [
    { "id": "daily-1000", "amount": "5.00", ... }
  ]
}
```

The agent parses this, selects a payment method, pays, and retries.
