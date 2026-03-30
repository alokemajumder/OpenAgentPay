# @openagentpay/server-cloudflare

Cloudflare Workers paywall handler with KV-backed receipt storage. Uses web standard Request/Response APIs.

## Install

```bash
npm install @openagentpay/server-cloudflare
```

## Usage

```typescript
import { createPaywallHandler } from '@openagentpay/server-cloudflare';

export default {
  fetch: createPaywallHandler({
    pricing: { amount: '0.01', currency: 'USD' },
    recipient: '0x...',
    adapters: [mpp()],
  }, {
    handler: async (req) => new Response('Premium data'),
  }),
};
```

See the [main documentation](../../README.md) for full details.
