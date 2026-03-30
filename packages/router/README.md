# @openagentpay/router

14 intelligent routing strategies for selecting the optimal payment adapter. Includes health tracking, cost estimation, and cascade failover.

## Install

```bash
npm install @openagentpay/router
```

## Usage

```typescript
import { createRouter } from '@openagentpay/router';

const router = createRouter({
  adapters: [
    { adapter: mppAdapter, costPerTransaction: '0.001' },
    { adapter: stripeAdapter, costPerTransaction: '0.30', costPercentage: 2.9 },
  ],
  strategy: 'smart',
  cascade: true,
});
```

Strategies: priority, lowest-cost, highest-success, lowest-latency, round-robin, weighted, smart, adaptive, conditional, amount-tiered, geo-aware, time-aware, failover-only, custom.

See the [main documentation](../../README.md) for full details.
