# Client SDK Guide

## Overview

The client SDK gives AI agents the ability to autonomously discover, evaluate, and pay for API calls.

## Installation

```bash
pnpm add @openagentpay/client @openagentpay/core

# Choose a wallet adapter
pnpm add @openagentpay/adapter-mock     # for testing
pnpm add @openagentpay/adapter-x402     # for real USDC payments
pnpm add @openagentpay/adapter-credits  # for prepaid credits
```

## Basic Usage

```typescript
import { withPayment } from '@openagentpay/client';
import { mockWallet } from '@openagentpay/adapter-mock';

const paidFetch = withPayment(fetch, {
  wallet: mockWallet(),
  policy: {
    maxPerRequest: '1.00',
    maxPerDay: '50.00',
  },
});

// Use exactly like fetch — payments happen transparently
const response = await paidFetch('https://api.example.com/search?q=test');
const data = await response.json();
```

## What Happens Under the Hood

1. `paidFetch` makes the request normally
2. If the response is 200 → returned as-is (no payment needed)
3. If the response is 402 → the client:
   - Parses the payment requirement
   - Checks the policy engine (is this amount OK? domain allowed?)
   - Selects a payment method the wallet supports
   - Executes payment
   - Retries the request with payment proof
   - Collects a receipt
   - Returns the response

## Policy Configuration

The policy engine prevents runaway spending:

```typescript
const paidFetch = withPayment(fetch, {
  wallet: mockWallet(),
  policy: {
    maxPerRequest: '1.00',          // max per single call
    maxPerDay: '50.00',             // daily budget cap
    maxPerSession: '100.00',        // session budget cap
    maxPerProvider: '10.00',        // per-domain daily cap
    allowedDomains: ['api.example.com', '*.trusted.dev'],
    blockedDomains: ['*.malicious.com'],
    allowedCurrencies: ['USDC', 'USD'],
    approvalThreshold: '5.00',     // require human approval above this
    testMode: false,                // only allow mock payments
  },
});
```

## Receipts

Every payment generates a receipt:

```typescript
const paidFetch = withPayment(fetch, {
  wallet: mockWallet(),
  onReceipt: (receipt) => {
    console.log(`Paid ${receipt.payment.amount} for ${receipt.request.url}`);
    console.log(`Transaction: ${receipt.payment.transaction_hash}`);
    console.log(`Latency: ${receipt.response.latency_ms}ms`);
  },
});
```

## Real Payments (x402)

```typescript
import { x402Wallet } from '@openagentpay/adapter-x402';

const paidFetch = withPayment(fetch, {
  wallet: x402Wallet({
    privateKey: process.env.AGENT_WALLET_KEY,
    network: 'base-sepolia', // or 'base' for mainnet
  }),
  policy: {
    maxPerRequest: '0.10',
    maxPerDay: '5.00',
  },
});
```

## Credits

```typescript
import { creditsWallet } from '@openagentpay/adapter-credits';

const paidFetch = withPayment(fetch, {
  wallet: creditsWallet({
    accountId: 'agent-001',
    initialBalance: '100.00',
  }),
});
```

## Error Handling

```typescript
import { PolicyDeniedError } from '@openagentpay/core';

try {
  const response = await paidFetch('https://api.example.com/expensive');
} catch (error) {
  if (error instanceof PolicyDeniedError) {
    console.log(`Policy denied: ${error.message}`);
    // e.g., "Amount $5.00 exceeds maxPerRequest ($1.00)"
  }
}
```

## Subscription Auto-Optimization

The client can automatically switch to subscriptions when they save money:

```typescript
const paidFetch = withPayment(fetch, {
  wallet: mockWallet(),
  subscription: {
    autoOptimize: true,
    maxCommitment: '50.00',
    preferredPeriod: 'day',
    autoCancelOnIdle: '1h',
    savingsThreshold: 0.20, // subscribe when 20%+ savings
  },
});
```
