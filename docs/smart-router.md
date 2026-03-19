# Smart Router

The Smart Router is the orchestration brain of OpenAgentPay. It selects the optimal payment adapter for each transaction based on cost, success rate, latency, region, amount, time of day, and custom rules — then automatically fails over to alternatives if the primary adapter fails.

## Installation

```bash
pnpm add @openagentpay/router @openagentpay/core
```

## Basic Usage

```typescript
import { createRouter } from '@openagentpay/router';
import { mpp } from '@openagentpay/adapter-mpp';
import { x402 } from '@openagentpay/adapter-x402';
import { stripe } from '@openagentpay/adapter-stripe';
import { credits } from '@openagentpay/adapter-credits';

const router = createRouter({
  adapters: [
    { adapter: mpp({ networks: ['tempo'] }), priority: 1, costPerTransaction: '0.001', currencies: ['USDC'] },
    { adapter: x402({ network: 'base' }), priority: 2, costPerTransaction: '0.001', currencies: ['USDC'] },
    { adapter: stripe({ secretKey: '...' }), priority: 3, costPerTransaction: '0.30', costPercentage: 2.9, minimumAmount: '0.50', currencies: ['USD', 'EUR'] },
    { adapter: credits({ store }), priority: 4, costPerTransaction: '0', currencies: ['USDC', 'USD'] },
  ],
  strategy: 'smart',
  cascade: true,
  maxCascadeAttempts: 3,
});

// Select the best adapter for a payment
const decision = router.select({ amount: '0.01', currency: 'USDC' });
console.log(decision.adapter.type);  // 'mpp'
console.log(decision.reason);        // 'mpp selected — smart scoring: cost $0.001, 98% success, 120ms latency'

// Record outcomes to improve future routing
router.recordSuccess('mpp', { latencyMs: 150 });
router.recordFailure('stripe', { error: 'card_declined' });
```

## All 14 Strategies

### 1. `priority` — Static Order

Sorts adapters by their `priority` field (lower = higher priority). This is the default and replicates the behavior of listing adapters in a specific order.

```typescript
const router = createRouter({
  adapters: [
    { adapter: mpp({ ... }), priority: 1 },
    { adapter: x402({ ... }), priority: 2 },
    { adapter: stripe({ ... }), priority: 3 },
  ],
  strategy: 'priority',
});
```

### 2. `lowest-cost` — Cheapest Viable

Sorts by estimated fee for the transaction amount. Non-viable adapters (below minimum amount, wrong currency) are excluded.

Cost formula: `fee = costPerTransaction + (amount × costPercentage / 100)`

```typescript
const router = createRouter({
  adapters: [
    { adapter: mpp({ ... }), costPerTransaction: '0.001' },                        // $0.001
    { adapter: stripe({ ... }), costPerTransaction: '0.30', costPercentage: 2.9 },  // $0.30 + 2.9%
    { adapter: credits({ ... }), costPerTransaction: '0' },                          // free
  ],
  strategy: 'lowest-cost',
});

// For a $0.01 transaction: credits ($0) → mpp ($0.001) → stripe (excluded, below $0.50 min)
```

### 3. `highest-success` — Best Success Rate

Sorts by recent success rate from the health tracker (sliding window). Adapters below `minSuccessRate` are excluded. Adapters with no data are kept (optimistic — they need traffic to build history).

```typescript
const router = createRouter({
  adapters: [...],
  strategy: 'highest-success',
  minSuccessRate: 0.7,  // exclude adapters with <70% success
});
```

### 4. `lowest-latency` — Fastest Response

Sorts by average response time. Adapters with no data go to the end (they need to be tried to gather latency data).

### 5. `round-robin` — Even Distribution

Rotates through healthy adapters using a persistent counter. Ensures each adapter gets roughly equal traffic. Falls back to priority order if all adapters are unhealthy.

### 6. `weighted` — Probabilistic Selection

Selects adapters probabilistically based on their `weight` field (0-100). Higher weight = higher probability. Useful for A/B testing payment rails — e.g., send 80% to MPP and 20% to x402.

```typescript
const router = createRouter({
  adapters: [
    { adapter: mpp({ ... }), weight: 80 },
    { adapter: x402({ ... }), weight: 20 },
  ],
  strategy: 'weighted',
});
```

### 7. `smart` — Composite Score

Balances success rate, cost, and latency in a single score:

```
score = (successRate × 0.5) + ((1 - normalizedCost) × 0.3) + ((1 - normalizedLatency) × 0.2)
```

Values are normalized across all viable adapters. Highest score wins. This is the recommended strategy for most use cases.

### 8. `adaptive` — Multi-Armed Bandit

Exploration/exploitation balance inspired by Juspay's dynamic gateway ordering. Uses epsilon-greedy algorithm:

- With probability `explorationRate` (default 10%): randomly shuffle viable adapters (exploration — discovers if underperforming adapters have recovered)
- With probability `1 - explorationRate` (default 90%): use smart scoring (exploitation — route to the proven best)

```typescript
const router = createRouter({
  adapters: [...],
  strategy: 'adaptive',
  explorationRate: 0.1,  // 10% exploration, 90% exploitation
});
```

Over time, the router learns which adapter performs best while continuously probing alternatives.

### 9. `conditional` — Rule-Based Routing

Define if/else rules that map conditions to preferred adapter orderings. First matching rule wins. If no rule matches, falls back to priority.

```typescript
import type { RoutingRule } from '@openagentpay/router';

const rules: RoutingRule[] = [
  {
    name: 'micropayments',
    condition: (req) => parseFloat(req.amount) < 0.50,
    preferredAdapters: ['mpp', 'x402', 'credits'],
  },
  {
    name: 'india',
    condition: (req) => req.region === 'IN',
    preferredAdapters: ['upi', 'credits', 'mpp'],
  },
  {
    name: 'fiat-preferred',
    condition: (req) => ['USD', 'EUR', 'GBP'].includes(req.currency),
    preferredAdapters: ['stripe', 'paypal', 'credits'],
    fallbackStrategy: 'lowest-cost',
  },
];

const router = createRouter({
  adapters: [...],
  strategy: 'conditional',
  rules,
});
```

### 10. `amount-tiered` — Amount-Range Routing

Different strategy per transaction amount range. Micropayments need different routing than large payments.

```typescript
import type { AmountTier } from '@openagentpay/router';

const tiers: AmountTier[] = [
  { name: 'micro', maxAmount: 0.50, strategy: 'lowest-cost', preferredAdapters: ['mpp', 'x402', 'credits'] },
  { name: 'medium', maxAmount: 10, strategy: 'smart' },
  { name: 'large', maxAmount: Infinity, strategy: 'highest-success' },
];

const router = createRouter({
  adapters: [...],
  strategy: 'amount-tiered',
  amountTiers: tiers,
});

// $0.01 → micro tier → lowest-cost → mpp
// $5.00 → medium tier → smart scoring
// $50.00 → large tier → highest-success → stripe
```

### 11. `geo-aware` — Region-Based Routing

Routes based on agent or provider geographic region. Different payment rails perform better in different markets.

```typescript
import type { RegionPreference } from '@openagentpay/router';

const regions: RegionPreference[] = [
  { region: 'IN', preferredAdapters: ['upi', 'credits', 'mpp'] },
  { region: 'US', preferredAdapters: ['mpp', 'stripe', 'x402'] },
  { region: 'EU', preferredAdapters: ['mpp', 'stripe', 'paypal'] },
  { region: 'BR', preferredAdapters: ['paypal', 'credits'] },
];

const router = createRouter({
  adapters: [...],
  strategy: 'geo-aware',
  regionPreferences: regions,
});

// Pass region in the route request
router.select({ amount: '1.00', currency: 'INR', region: 'IN' });
// → UPI selected (cheapest for India)
```

### 12. `time-aware` — Time-of-Day Routing

Optimizes routing based on UTC hour. Different adapters may have different performance characteristics at different times (e.g., card processor batch settlement windows, crypto network congestion).

```typescript
import type { TimeWindow } from '@openagentpay/router';

const windows: TimeWindow[] = [
  { startHour: 0, endHour: 6, preferredAdapters: ['mpp', 'x402'], strategy: 'lowest-cost' },
  { startHour: 6, endHour: 18, preferredAdapters: ['stripe', 'mpp'], strategy: 'smart' },
  { startHour: 18, endHour: 0, preferredAdapters: ['mpp', 'x402', 'credits'], strategy: 'highest-success' },
];

const router = createRouter({
  adapters: [...],
  strategy: 'time-aware',
  timeWindows: windows,
});
```

### 13. `failover-only` — Primary/Secondary Switching

Uses the highest-priority healthy adapter exclusively. When it becomes unhealthy, ALL traffic switches to the next healthy adapter — not per-request retry, but a sustained switch.

Includes recovery probes: every `probeInterval` requests (default 20), one request is sent to the failed primary to detect recovery.

```typescript
const router = createRouter({
  adapters: [
    { adapter: mpp({ ... }), priority: 1 },   // primary
    { adapter: x402({ ... }), priority: 2 },   // secondary
    { adapter: credits({ ... }), priority: 3 }, // tertiary
  ],
  strategy: 'failover-only',
  probeInterval: 20,
});
```

### 14. `custom` — User-Defined Scoring

Full control. Define a scoring function that receives adapter entry, health data, cost estimate, and the request. Return a numeric score — highest wins.

```typescript
import type { CustomScoringFn } from '@openagentpay/router';

const scoring: CustomScoringFn = (entry, health, cost, request) => {
  // Heavily penalize slow adapters
  const latencyPenalty = health.avgLatencyMs > 500 ? 0.5 : 1.0;
  // Exponentially reward cheap adapters
  const costBonus = 1 / (1 + parseFloat(cost.transactionCost));
  // Boost adapters with high success and low p95
  const reliabilityScore = health.successRate * (1 - health.p95LatencyMs / 10000);
  return reliabilityScore * costBonus * latencyPenalty;
};

const router = createRouter({
  adapters: [...],
  strategy: 'custom',
  customScoring: scoring,
});
```

## Health Tracking

The `HealthTracker` maintains per-adapter metrics in a sliding time window (default 5 minutes):

```typescript
const health = router.getHealth('mpp');
// {
//   adapterType: 'mpp',
//   successRate: 0.98,       // 98%
//   avgLatencyMs: 120,       // 120ms average
//   p95LatencyMs: 350,       // 350ms p95
//   totalAttempts: 500,
//   recentSuccesses: 490,
//   recentFailures: 10,
//   lastFailureError: 'facilitator_timeout',
//   lastSuccessAt: '2026-03-19T...',
//   lastFailureAt: '2026-03-19T...',
//   isHealthy: true,
// }

// All adapters
const allHealth = router.getAllHealth();
```

Health data is automatically collected when using `executeWithCascade()`. For manual tracking:

```typescript
router.recordSuccess('mpp', { latencyMs: 150 });
router.recordFailure('stripe', { error: 'card_declined' });
```

## Cost Estimation

```typescript
const estimate = router.estimateCost(adapterEntry, '10.00', 'USD');
// {
//   adapterType: 'stripe',
//   transactionCost: '0.590000',  // $0.30 + 2.9% of $10
//   effectiveRate: '5.90',        // 5.9% of transaction
//   isViable: true,
// }
```

## Cascade Failover

When `cascade: true`, failed payments automatically retry with the next-best adapter:

```typescript
const result = await router.executeWithCascade(
  { amount: '0.01', currency: 'USDC' },
  async (adapter) => {
    try {
      await processPayment(adapter);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
  (adapter, attempt) => console.log(`Attempt ${attempt}: trying ${adapter.type}`),
);

// result.success: true
// result.adapter: the adapter that succeeded
// result.attempts: [
//   { adapterType: 'mpp', attemptNumber: 1, success: false, error: 'timeout', latencyMs: 5000 },
//   { adapterType: 'x402', attemptNumber: 2, success: true, latencyMs: 200 },
// ]
```

## Eligibility Filtering

Before any strategy runs, adapters are filtered by:
- **Enabled** — `enabled: false` removes the adapter
- **Currency** — adapter must support the requested currency
- **Region** — adapter must support the requested region (if specified)
- **Amount bounds** — transaction must be within `[minimumAmount, maximumAmount]`

```typescript
{
  adapter: stripe({ ... }),
  enabled: true,
  currencies: ['USD', 'EUR', 'GBP'],
  regions: ['US', 'EU'],
  minimumAmount: '0.50',
  maximumAmount: '10000',
}
```

## Strategy Selection at Runtime

You can override the default strategy per-request:

```typescript
// Default strategy is 'smart', but use 'lowest-cost' for this request
const decision = router.select({ amount: '0.01', currency: 'USDC' }, 'lowest-cost');
```
