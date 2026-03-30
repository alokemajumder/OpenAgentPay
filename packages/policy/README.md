# @openagentpay/policy

Spend governance engine with 12 rules for controlling agent payment behavior. Enforces budgets, domain restrictions, currency limits, and identity requirements.

## Install

```bash
npm install @openagentpay/policy
```

## Usage

```typescript
import { createPolicyEngine } from '@openagentpay/policy';

const engine = createPolicyEngine({
  maxPerRequest: '1.00',
  maxPerDay: '50.00',
  allowedDomains: ['*.trusted.dev'],
  identityRequired: true,
});

const result = engine.evaluate(paymentRequest);
```

Rules: maxPerRequest, maxPerDay, maxPerSession, maxPerProvider, allowedDomains, blockedDomains, allowedCurrencies, approvalThreshold, testMode, identityRequired, custom engine.

See the [main documentation](../../README.md) for full details.
