# @openagentpay/razorpay-mcp

Razorpay MCP server client for AI agent payments. Access 48+ Razorpay tools via JSON-RPC 2.0.

## Install

```bash
npm install @openagentpay/razorpay-mcp
```

## Usage

```typescript
import { createRazorpayMCP } from '@openagentpay/razorpay-mcp';

const rzp = createRazorpayMCP({
  apiKeyId: process.env.RAZORPAY_KEY_ID,
  apiKeySecret: process.env.RAZORPAY_KEY_SECRET,
});

const link = await rzp.tools.createPaymentLink({
  amount: 50000, currency: 'INR', description: 'API credits', upiLink: true,
});
```

See the [main documentation](../../README.md) for full details.
