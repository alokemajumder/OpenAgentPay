# Policy Engine Guide

## Overview

The policy engine prevents runaway agent spending. It evaluates configurable rules before every payment, enforcing budgets, domain restrictions, and approval workflows.

## Installation

```bash
pnpm add @openagentpay/policy @openagentpay/core
```

## Basic Usage

```typescript
import { createPolicy } from '@openagentpay/policy';

const policy = createPolicy({
  maxPerRequest: '1.00',
  maxPerDay: '50.00',
  allowedDomains: ['api.example.com', '*.trusted.dev'],
});

// Evaluate a payment decision
const result = policy.evaluate({
  amount: '0.50',
  currency: 'USDC',
  domain: 'api.example.com',
});

if (result.approved) {
  // Proceed with payment
  policy.recordSpend('api.example.com', '0.50');
} else {
  console.log(`Denied: ${result.reason}`);
}
```

## All Rules

| Rule | Type | Description |
|------|------|-------------|
| `maxPerRequest` | `string` | Maximum per single payment |
| `maxPerDay` | `string` | Maximum total in 24h rolling window |
| `maxPerSession` | `string` | Maximum since policy creation |
| `maxPerProvider` | `string` | Maximum per domain per 24h |
| `allowedDomains` | `string[]` | Glob patterns for approved domains |
| `blockedDomains` | `string[]` | Glob patterns for blocked domains |
| `allowedCurrencies` | `string[]` | Restrict to specific currencies |
| `approvalThreshold` | `string` | Require approval above this amount |
| `maxSubscription` | `string` | Maximum subscription commitment |
| `maxSubscriptionPeriod` | `string` | Longest subscription period allowed |
| `autoSubscribe` | `boolean` | Allow auto-optimization to subscriptions |
| `testMode` | `boolean` | Only allow mock payments |

## Rule Evaluation Order

Rules are checked in this order. First denial stops evaluation:

1. `testMode` — reject non-mock if enabled
2. `blockedDomains` — deny if domain matches
3. `allowedDomains` — deny if domain doesn't match
4. `allowedCurrencies` — deny if currency not allowed
5. `maxPerRequest` — deny if amount exceeds limit
6. `maxPerDay` — deny if daily total would exceed
7. `maxPerSession` — deny if session total would exceed
8. `maxPerProvider` — deny if provider total would exceed
9. `maxSubscription` — deny subscription if too expensive
10. `maxSubscriptionPeriod` — deny subscription if too long
11. `approvalThreshold` — flag for human approval if above threshold
12. All pass → **APPROVE**

## Domain Glob Patterns

- `api.example.com` — exact match
- `*.example.com` — matches `api.example.com` (one level)
- `**.example.com` — matches `api.example.com` and `deep.api.example.com`

## Spend Tracking

```typescript
// After a successful payment
policy.recordSpend('api.example.com', '0.50');

// Query current spend
policy.getDailyTotal();       // '14.30' (24h rolling)
policy.getSessionTotal();     // '42.50' (since creation)
policy.getProviderTotal('api.example.com'); // '3.20'

// Reset (useful in tests)
policy.reset();
```

## Integration with Client SDK

The client SDK has built-in policy evaluation. You can configure it directly:

```typescript
const paidFetch = withPayment(fetch, {
  wallet: mockWallet(),
  policy: {
    maxPerRequest: '1.00',
    maxPerDay: '50.00',
    allowedDomains: ['*.trusted.dev'],
    approvalThreshold: '5.00',
  },
});
```

Or use the standalone policy engine for more control:

```typescript
const policy = createPolicy({ maxPerDay: '20.00' });

// Manual evaluation before payment
const decision = policy.evaluate({
  amount: price,
  currency: 'USDC',
  domain: new URL(url).hostname,
});

if (!decision.approved) {
  throw new Error(decision.reason);
}
```
