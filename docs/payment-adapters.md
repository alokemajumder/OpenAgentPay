# Payment Adapters

OpenAgentPay uses an adapter pattern for payment methods. Each adapter handles detection, verification, and execution for a specific payment type.

## Available Adapters

| Adapter | Package | Payment Type | Use Case |
|---------|---------|-------------|----------|
| Mock | `@openagentpay/adapter-mock` | Simulated | Development, testing, CI |
| Credits | `@openagentpay/adapter-credits` | Prepaid balance | Predictable budgets |
| x402 | `@openagentpay/adapter-x402` | USDC stablecoin | Production payments |

## Mock Adapter

Zero-friction testing. Every payment succeeds. No real money.

```typescript
import { mock, mockWallet } from '@openagentpay/adapter-mock';

// Server
const paywall = createPaywall({
  recipient: '0x...',
  adapters: [mock()],  // or mock({ logging: false }) for quiet mode
});

// Client
const wallet = mockWallet({ initialBalance: '1000.00' });
wallet.getBalance();       // '1000.00'
wallet.getPaymentHistory(); // []
wallet.getTotalSpent();    // '0'
```

## Credits Adapter

Prepaid balance system. Agents buy credits upfront, spend them per-call.

```typescript
import { credits, creditsWallet, InMemoryCreditStore } from '@openagentpay/adapter-credits';

// Server: set up credit store
const store = new InMemoryCreditStore();
await store.createAccount('agent-001', '100.00', 'USDC');

const paywall = createPaywall({
  recipient: '0x...',
  adapters: [credits({
    store,
    purchaseUrl: 'https://api.example.com/credits/buy',
    balanceUrl: 'https://api.example.com/credits/balance',
  })],
});

// Client
const wallet = creditsWallet({
  accountId: 'agent-001',
  initialBalance: '100.00',
});
```

## x402 Adapter

Real USDC stablecoin payments on Base (Coinbase's L2).

```typescript
import { x402, x402Wallet } from '@openagentpay/adapter-x402';

// Server
const paywall = createPaywall({
  recipient: '0xYourWalletAddress',
  adapters: [x402({
    network: 'base-sepolia',  // or 'base' for mainnet
    facilitatorUrl: 'https://x402.org/facilitator',
  })],
});

// Client
const wallet = x402Wallet({
  privateKey: process.env.AGENT_WALLET_KEY,
  network: 'base-sepolia',
});

console.log(wallet.getAddress()); // derived wallet address
```

## Writing a Custom Adapter

Implement the `PaymentAdapter` interface:

```typescript
import type { PaymentAdapter, VerifyResult, PaymentProof, Pricing, PaymentMethod, IncomingRequest } from '@openagentpay/core';

class MyAdapter implements PaymentAdapter {
  readonly type = 'my-method';

  detect(req: IncomingRequest): boolean {
    // Check if the request contains payment for this adapter
    return !!req.headers['x-my-payment'];
  }

  async verify(req: IncomingRequest, pricing: Pricing): Promise<VerifyResult> {
    // Verify the payment is valid and sufficient
    return { valid: true, receipt: { /* partial receipt data */ } };
  }

  describeMethod(config: Record<string, unknown>): PaymentMethod {
    // Return the payment method block for 402 responses
    return { type: 'my-method', /* ... */ } as any;
  }

  supports(method: PaymentMethod): boolean {
    return (method as any).type === 'my-method';
  }

  async pay(method: PaymentMethod, pricing: Pricing): Promise<PaymentProof> {
    // Execute payment (client side)
    return { header: 'X-MY-PAYMENT', value: 'proof-data' };
  }
}
```
