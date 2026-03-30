# @openagentpay/server-express

Express paywall middleware. Returns 402 with pricing, detects payment headers, verifies via adapters, serves resources. Includes subscription endpoints and `/.well-known/agent-pay` service discovery.

## Install

```bash
npm install @openagentpay/server-express
```

## Usage

```typescript
import { createPaywall, discoveryMiddleware } from '@openagentpay/server-express';

const paywall = createPaywall({
  recipient: '0xYourWallet',
  adapters: [mpp(), x402()],
});

app.get('/api/data', paywall({ price: '0.01' }), handler);
app.use(paywall.routes()); // subscription endpoints
```

See the [main documentation](../../README.md) for full details.
