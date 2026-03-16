# Payment Adapters

OpenAgentPay uses an adapter pattern for payment methods. Each adapter handles detection, verification, and execution for a specific payment rail. The server tries adapters in declaration order — first match wins.

## Available Adapters

| Adapter | Package | Type | Per-Call Viable? |
|---------|---------|------|-----------------|
| Mock | `@openagentpay/adapter-mock` | Simulated | Yes (testing only) |
| Credits | `@openagentpay/adapter-credits` | Prepaid balance | Yes (zero per-call fees) |
| x402 | `@openagentpay/adapter-x402` | USDC stablecoin | Yes (~$0.001 per call) |
| Stripe | `@openagentpay/adapter-stripe` | Fiat (card) | Only above $0.50 |
| PayPal | `@openagentpay/adapter-paypal` | Fiat (PayPal) | Only above ~$1.00 |
| UPI | `@openagentpay/adapter-upi` | Fiat (India) | Via mandate aggregation |

## Mock

Simulated payments for development. Every payment auto-succeeds. No real money.

```typescript
import { mock, mockWallet } from '@openagentpay/adapter-mock';

// Server — mock() returns a MockAdapter
const paywall = createPaywall({ recipient: '0x...', adapters: [mock()] });
// Options: mock({ logging: false }) for silent mode

// Client — mockWallet() returns a MockWallet
const wallet = mockWallet({ initialBalance: '1000.00' });
wallet.getBalance();         // '1000.00'
wallet.getTotalSpent();      // '0'
wallet.getPaymentCount();    // 0
wallet.getPaymentHistory();  // []
wallet.reset();              // reset balance and history
```

Header: `X-PAYMENT: mock:<nonce>`

## Credits

Prepaid balance system. Agent pre-purchases credits, spends them per-call. Zero per-call processing fees.

```typescript
import { credits, creditsWallet, InMemoryCreditStore } from '@openagentpay/adapter-credits';

// Server — create a credit store and accounts
const store = new InMemoryCreditStore();
await store.createAccount('agent-001', '100.00', 'USDC');

const paywall = createPaywall({
  recipient: '0x...',
  adapters: [credits({
    store,
    purchaseUrl: '/credits/buy',
    balanceUrl: '/credits/balance',
  })],
});

// Client
const wallet = creditsWallet({
  accountId: 'agent-001',
  initialBalance: '100.00',
  currency: 'USDC',
});
wallet.getBalance();    // '100.00'
wallet.topUp('50.00');  // add credits
```

Header: `X-CREDITS: <account_id>:<signature>`

CreditStore interface methods: `createAccount()`, `getAccount()`, `deduct()`, `topUp()`

## x402 (USDC on Base)

Real stablecoin payments. Agent signs an EIP-3009 `transferWithAuthorization`. Facilitator settles on-chain. USDC goes directly to the API owner's wallet.

```typescript
import { x402, x402Wallet } from '@openagentpay/adapter-x402';

// Server
const paywall = createPaywall({
  recipient: '0xYourWalletAddress',
  adapters: [x402({
    network: 'base-sepolia',       // or 'base' for mainnet
    facilitatorUrl: 'https://x402.org/facilitator',  // default
    timeoutSeconds: 300,           // default
  })],
});

// Client
const wallet = x402Wallet({
  privateKey: process.env.AGENT_WALLET_KEY!,
  network: 'base-sepolia',
});
wallet.getAddress();   // derived Ethereum address
wallet.getNetwork();   // 'base-sepolia'
```

Header: `X-PAYMENT: <base64 EIP-3009 payload>`

Supported networks: `base` (Chain ID 8453), `base-sepolia` (Chain ID 84532)

USDC contract addresses:
- Base mainnet: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- Base Sepolia: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`

## Stripe

Fiat payments via Stripe. Two modes: direct per-call charges (minimum $0.50) or credit purchases via Stripe Checkout.

```typescript
import { stripe, StripeAdapter, StripeCreditBridge } from '@openagentpay/adapter-stripe';

// Mode 1: Direct charges (for calls > $0.50)
const paywall = createPaywall({
  recipient: '0x...',
  adapters: [stripe({
    secretKey: process.env.STRIPE_SECRET_KEY!,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  })],
});

// Mode 2: Credit bridge (recommended for micropayments)
const bridge = new StripeCreditBridge({
  stripeSecretKey: process.env.STRIPE_SECRET_KEY!,
  creditStore: store,         // InMemoryCreditStore from adapter-credits
  successUrl: 'https://yoursite.com/credits/success',
  cancelUrl: 'https://yoursite.com/credits/cancel',
  currency: 'usd',
  creditAmounts: [5, 10, 25, 50, 100],
});

// Create Checkout Session for credit purchase
const session = await bridge.createCheckoutSession({
  amount: 5000,               // $50.00 in cents
  payerIdentifier: 'agent-001',
});
// → { sessionId: 'cs_...', url: 'https://checkout.stripe.com/...' }

// Handle webhook (checkout.session.completed) to top up credits
await bridge.handleWebhook(body, signature);
```

Header: `X-STRIPE-SESSION: <payment_intent_id or session_id>`

Stripe verifies PaymentIntent (`pi_*`) and Checkout Session (`cs_*`) status via REST API. No Stripe SDK dependency — uses native `fetch` with `Authorization: Bearer sk_...`.

## PayPal

Fiat payments via PayPal. Credit purchases via PayPal Orders. OAuth2 client credentials auth.

```typescript
import { paypal, PayPalAdapter, PayPalCreditBridge } from '@openagentpay/adapter-paypal';

// Direct adapter
const paywall = createPaywall({
  recipient: '0x...',
  adapters: [paypal({
    clientId: process.env.PAYPAL_CLIENT_ID!,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET!,
    sandbox: true,    // use PayPal sandbox
  })],
});

// Credit bridge
const bridge = new PayPalCreditBridge({
  clientId: process.env.PAYPAL_CLIENT_ID!,
  clientSecret: process.env.PAYPAL_CLIENT_SECRET!,
  creditStore: store,
  returnUrl: 'https://yoursite.com/credits/success',
  cancelUrl: 'https://yoursite.com/credits/cancel',
  sandbox: true,
});

const order = await bridge.createOrder({
  amount: '50.00',
  payerIdentifier: 'agent-001',
});
// → { orderId: '...', approvalUrl: 'https://paypal.com/...' }

await bridge.captureOrder(order.orderId);
// → credits added to agent's account
```

Header: `X-PAYPAL-ORDER: <order_id>`

PayPal verifies Order status via REST API (`GET /v2/checkout/orders/{id}`). Access tokens are cached and auto-refreshed.

## UPI (India)

Payments via UPI. AutoPay mandates for recurring charges. Near-zero fees for transactions under Rs 2,000.

```typescript
import { upi, UPIAdapter, UPIMandateManager, UPICreditBridge } from '@openagentpay/adapter-upi';

// Direct adapter
const paywall = createPaywall({
  recipient: '0x...',
  adapters: [upi({
    gateway: 'razorpay',       // 'razorpay' | 'cashfree' | 'generic'
    apiKey: process.env.RAZORPAY_KEY_ID!,
    apiSecret: process.env.RAZORPAY_KEY_SECRET!,
    sandbox: true,
  })],
});

// Mandate manager — for recurring auto-debits
const mandates = new UPIMandateManager({
  gateway: 'razorpay',
  apiKey: process.env.RAZORPAY_KEY_ID!,
  apiSecret: process.env.RAZORPAY_KEY_SECRET!,
  maxAmount: 500000,           // Rs 5,000 in paise
  frequency: 'daily',
  sandbox: true,
});

const mandate = await mandates.createMandate({
  payerIdentifier: 'agent-001',
  description: 'API usage billing',
});
// → { mandateId: '...', authUrl: '...' }  (agent operator approves once via UPI app)

// Execute debit against mandate (fully autonomous)
await mandates.executeMandateDebit({
  mandateId: mandate.mandateId,
  amount: 10000,               // Rs 100 in paise
  description: 'Daily API usage',
});
```

Header: `X-UPI-REFERENCE: <transaction_reference>`

Supported gateways: Razorpay (Basic Auth, amounts in paise), Cashfree (API key headers, amounts in INR decimal), generic (configurable).

## Using multiple adapters

Adapters are tried in declaration order. The first one that detects payment in the request handles it. All adapters are included in the 402 response's `methods` array.

```typescript
const paywall = createPaywall({
  recipient: '0x...',
  adapters: [
    x402({ network: 'base' }),           // try crypto first
    credits({ store }),                   // then prepaid credits
    stripe({ secretKey: '...' }),         // then Stripe
    paypal({ clientId: '...', clientSecret: '...' }),  // then PayPal
  ],
});
```

The 402 response will list all four payment methods. The agent picks the one its wallet supports.

## Writing a custom adapter

Implement the `PaymentAdapter` interface from `@openagentpay/core`:

```typescript
import type { PaymentAdapter, VerifyResult, PaymentProof, Pricing,
  PaymentMethod, AdapterConfig, IncomingRequest } from '@openagentpay/core';

class MyAdapter implements PaymentAdapter {
  readonly type = 'my-method';

  detect(req: IncomingRequest): boolean {
    const header = req.headers['x-my-payment'];
    return typeof header === 'string' && header.length > 0;
  }

  async verify(req: IncomingRequest, pricing: Pricing): Promise<VerifyResult> {
    // Verify payment, return receipt data
    return { valid: true, receipt: { payment: { method: 'my-method' as any, ... } } };
  }

  describeMethod(config: AdapterConfig): PaymentMethod {
    return { type: 'my-method', ... } as any;
  }

  supports(method: PaymentMethod): boolean {
    return (method as any).type === 'my-method';
  }

  async pay(method: PaymentMethod, pricing: Pricing): Promise<PaymentProof> {
    return { header: 'X-MY-PAYMENT', value: 'proof-data' };
  }
}
```

Server adapters use `detect()` and `verify()`. Client wallets use `supports()` and `pay()`.
