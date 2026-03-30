# @openagentpay/mcp-mpp

Bridge MCP tools with MPP for discovery and payment. Register tools with pricing and expose them via JSON-LD catalogs.

## Install

```bash
npm install @openagentpay/mcp-mpp
```

## Usage

```typescript
import { createBridge, createDiscovery } from '@openagentpay/mcp-mpp';

const bridge = createBridge({
  recipient: '0x...',
  mppConfig: { networks: ['tempo'] },
  defaultPricing: { amount: '0.01', currency: 'USD' },
});

bridge.registerTool('search', schema, handler);
const catalog = createDiscovery(bridge).describeTools();
```

See the [main documentation](../../README.md) for full details.
