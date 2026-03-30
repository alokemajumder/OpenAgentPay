# @openagentpay/proxy

Zero-code reverse proxy that adds 402 payment gating to any upstream API without code changes.

## Install

```bash
npm install @openagentpay/proxy
```

## Usage

```typescript
import { createProxy } from '@openagentpay/proxy';

const proxy = createProxy({
  upstream: 'https://internal-api.example.com',
  pricing: { amount: '0.01', currency: 'USD' },
  recipient: '0xYourWallet',
  freePaths: ['/health', '/docs/*'],
});

await proxy.start(3000);
```

See the [main documentation](../../README.md) for full details.
