# @openagentpay/mcp

Wrap MCP (Model Context Protocol) tool handlers with payment verification. Monetize any MCP tool.

## Install

```bash
npm install @openagentpay/mcp
```

## Usage

```typescript
import { paidTool } from '@openagentpay/mcp';

const search = paidTool({
  price: '0.01',
  adapters: [mpp(), x402()],
  recipient: '0x...',
}, async (params) => {
  return { results: await engine.search(params.query) };
});
```

See the [main documentation](../../README.md) for full details.
