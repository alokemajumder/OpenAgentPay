# @openagentpay/adapter-stripe

Stripe PaymentIntents adapter with credit bridge via Checkout. Supports per-call payments and credit top-ups.

## Install

```bash
npm install @openagentpay/adapter-stripe
```

## Usage

```typescript
import { stripe } from '@openagentpay/adapter-stripe';

const adapter = stripe({ secretKey: process.env.STRIPE_SECRET_KEY });
```

See the [main documentation](../../README.md) for full details.
