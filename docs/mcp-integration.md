# MCP Integration Guide

## Overview

OpenAgentPay enables paid MCP (Model Context Protocol) tools — tools that charge per invocation. This is the first standard for monetizing MCP tools.

## Installation

```bash
pnpm add @openagentpay/mcp @openagentpay/core @openagentpay/adapter-mock
```

## Server: Creating a Paid MCP Tool

```typescript
import { paidTool } from '@openagentpay/mcp';
import { mock } from '@openagentpay/adapter-mock';

// Wrap any tool handler with payment verification
const premiumSearch = paidTool({
  price: '0.01',
  currency: 'USDC',
  adapters: [mock()],
  recipient: '0xYourWalletAddress',
}, async (params: { query: string }) => {
  const results = await searchEngine.search(params.query);
  return { results };
});

// Register with your MCP server
server.tool('premium-search', premiumSearch);
```

### How It Works (Server Side)

1. Agent calls `premium-search` tool without payment
2. `paidTool` returns a payment requirement instead of results:
   ```json
   {
     "__openagentpay": true,
     "paymentRequired": {
       "type": "payment_required",
       "pricing": { "amount": "0.01", "currency": "USDC" },
       "methods": [{ "type": "mock", ... }]
     }
   }
   ```
3. Agent detects the payment requirement, pays, and retries with proof
4. `paidTool` verifies payment and runs the actual handler
5. Results are returned normally

## Client: Agent That Pays for MCP Tools

```typescript
import { withMCPPayment } from '@openagentpay/mcp';
import { mockWallet } from '@openagentpay/adapter-mock';

// Wrap your MCP client
const paidClient = withMCPPayment(mcpClient, {
  wallet: mockWallet(),
  policy: {
    maxPerCall: '0.10',      // max per tool invocation
    maxPerDay: '5.00',       // daily budget
    allowedTools: ['premium-search', 'data-lookup'], // only these tools
  },
  onReceipt: (receipt) => {
    console.log(`Paid ${receipt.payment.amount} for tool ${receipt.request.tool_name}`);
  },
});

// Use transparently — payment is handled automatically
const result = await paidClient.callTool('premium-search', { query: 'AI trends' });
// → { results: [...] }
```

### How It Works (Client Side)

1. `withMCPPayment` proxies the MCP client's `callTool` method
2. Calls the tool normally
3. If the result contains `__openagentpay: true`:
   - Parses the payment requirement
   - Checks spend policy (maxPerCall, maxPerDay, allowedTools)
   - Selects a wallet-supported payment method
   - Executes payment via wallet
   - Retries the tool call with `__openagentpay_payment` in params
   - Builds receipt, calls onReceipt
4. Returns the actual tool result

## Dynamic Pricing for MCP Tools

```typescript
const transcodeVideo = paidTool({
  price: '0.05', // base price, can be overridden
  adapters: [mock()],
  recipient: '0x...',
}, async (params: { url: string; format: string; quality: string }) => {
  // Price could vary by quality
  const result = await transcode(params.url, params.format, params.quality);
  return result;
});
```

## Subscription Support

```typescript
const searchTool = paidTool({
  price: '0.01',
  adapters: [mock()],
  recipient: '0x...',
  subscriptions: [
    {
      id: 'daily-unlimited',
      amount: '5.00',
      currency: 'USDC',
      period: 'day',
      calls: 'unlimited',
    },
  ],
}, handler);
```

## Framework Agnostic

The MCP adapter works with any MCP implementation. It doesn't depend on a specific MCP SDK — it operates at the protocol level by embedding payment data in tool params and results.

Any MCP client that has a `callTool(name, params)` method works with `withMCPPayment`.

## Use Cases

- **Search tools**: charge per query for premium data sources
- **AI inference**: charge per model invocation
- **Data enrichment**: charge per record enriched
- **Code execution**: charge per sandbox run
- **Media processing**: charge per file processed
- **Security scans**: charge per scan completed
