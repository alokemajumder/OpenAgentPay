# @openagentpay/client

Lightweight `fetch` wrapper that handles 402 Payment Required responses transparently. Parses pricing, evaluates spend policy, selects a payment method, pays, and retries.

## Install

```bash
npm install @openagentpay/client
```

## Usage

```typescript
import { withPayment } from '@openagentpay/client';
import { mppWallet } from '@openagentpay/adapter-mpp';

const paidFetch = withPayment(fetch, {
  wallet: mppWallet({ network: 'tempo', privateKey: process.env.KEY }),
  policy: { maxPerRequest: '1.00', maxPerDay: '50.00' },
});

const res = await paidFetch('https://api.example.com/data');
```

See the [main documentation](../../README.md) for full details.
