# @openagentpay/tax

Tax calculator and reporter for AI agent transactions. Built-in rates for US, EU, UK, India, Japan, Singapore. CSV/JSON export and capital gains tracking.

## Install

```bash
npm install @openagentpay/tax
```

## Usage

```typescript
import { createCalculator, createReporter } from '@openagentpay/tax';

const tax = createCalculator({ defaultJurisdiction: 'US-CA' });
const calc = tax.calculate('10.00', 'USD', 'stripe', 'US-CA');
// { grossAmount: '10.00', taxAmount: '0.73', netAmount: '10.73', taxRate: 0.0725 }
```

See the [main documentation](../../README.md) for full details.
