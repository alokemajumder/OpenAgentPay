# @openagentpay/server-hono

Hono paywall middleware for Bun, Deno, Node.js, and edge runtimes. Same capabilities as the Express middleware.

## Install

```bash
npm install @openagentpay/server-hono
```

## Usage

```typescript
import { createPaywall, discoveryMiddleware } from '@openagentpay/server-hono';

const paywall = createPaywall({
  recipient: '0xYourWallet',
  adapters: [mpp(), x402()],
});

app.get('/api/data', paywall({ price: '0.01' }), handler);
```

See the [main documentation](../../README.md) for full details.
