# Visa Integration

## What is Visa Intelligent Commerce?

Visa Intelligent Commerce enables AI agents to make payments using Visa's network. Two integration paths:

1. **Visa MCP Server** — agents obtain tokenized Visa payment credentials via MCP tools, scoped to specific merchants/amounts, enforced at the VisaNet network level
2. **AgentCard** — prepaid virtual Mastercard debit cards for agents, single-use, funded with exact amounts, no overdraft risk

## Installation

```bash
pnpm add @openagentpay/adapter-visa @openagentpay/core
```

## Visa MCP Mode

The agent obtains tokenized payment credentials from Visa's MCP server, scoped and time-limited.

```typescript
import { withPayment } from '@openagentpay/client';
import { visaWallet } from '@openagentpay/adapter-visa';

const paidFetch = withPayment(fetch, {
  wallet: visaWallet({
    mode: 'mcp',
    mcpUrl: 'https://sandbox.mcp.visa.com/mcp',
  }),
});
```

### Visa MCP Flow
1. Agent requests a paid API → gets 402 with Visa payment method
2. Agent calls Visa MCP server's `retrieve-payment-credentials` tool
3. Visa provisions a tokenized credential scoped to the transaction
4. Agent submits credential to the API in `X-VISA-TOKEN` header
5. API processes the tokenized payment through a payment gateway
6. VisaNet enforces transaction limits at the network level

## AgentCard Mode

AgentCard provides prepaid virtual debit cards. Each card is single-use, locked to the funded amount.

```typescript
import { visaWallet, AgentCardBridge } from '@openagentpay/adapter-visa';

// Create cards for agents
const cards = new AgentCardBridge({
  apiKey: process.env.AGENTCARD_API_KEY!,
});

// Create a single-use card funded with $10
const card = await cards.createCard({
  amount: '10.00',
  currency: 'USD',
  description: 'API access for research agent',
});
// → { cardId, lastFour, expiryMonth, expiryYear, status: 'active', fundedAmount: '10.00' }

// Check balance
const status = await cards.getCardStatus(card.cardId);

// Close when done
await cards.closeCard(card.cardId);

// Use as wallet for agent payments
const paidFetch = withPayment(fetch, {
  wallet: visaWallet({
    mode: 'agentcard',
    agentcardApiKey: process.env.AGENTCARD_API_KEY!,
  }),
});
```

### AgentCard Features
- **Single-use** — card is locked to the funded amount, no overdraft
- **Approval gates** — agent requests permission, human must confirm
- **Encrypted credentials** — card details encrypted with AES-256-GCM, decrypted only on explicit request
- **Works everywhere** — accepted at any merchant that takes Mastercard

## Server: Accept Visa Payments

```typescript
import { createPaywall } from '@openagentpay/server-express';
import { visa } from '@openagentpay/adapter-visa';

const paywall = createPaywall({
  recipient: '0x...',
  adapters: [visa({
    mode: 'tokenized',
    gatewayApiKey: process.env.PAYMENT_GATEWAY_KEY,
  })],
});

app.get('/api/data', paywall({ price: '1.00' }), handler);
```

The Visa adapter verifies tokenized card payments via the API owner's payment gateway.

## Combining with Other Methods

```typescript
const paywall = createPaywall({
  recipient: '0x...',
  adapters: [
    mpp({ networks: ['tempo', 'stripe'] }),     // crypto/Stripe first
    visa({ mode: 'tokenized' }),                 // Visa tokenized
    x402({ network: 'base' }),                   // direct USDC
    credits({ store }),                          // prepaid credits
  ],
});
```

## When to Use Visa vs. Other Methods

| Use Case | Best Method |
|----------|-------------|
| Micropayments ($0.001-$0.10) | x402, MPP (Tempo), or credits |
| Medium payments ($1-$100) | Visa, MPP (Stripe), Stripe direct |
| Enterprise with card-on-file | Visa MCP |
| Quick agent setup, any merchant | AgentCard |
| India | UPI |
