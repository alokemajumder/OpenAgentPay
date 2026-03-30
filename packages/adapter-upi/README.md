# @openagentpay/adapter-upi

UPI payment adapter for India. Supports Reserve Pay (SBMD) for agentic payments, AutoPay mandates, QR codes, refunds, and webhook verification. Works with Razorpay and Cashfree.

## Install

```bash
npm install @openagentpay/adapter-upi
```

## Usage

```typescript
import { upi, UPIReservePayManager } from '@openagentpay/adapter-upi';

// Payment verification
const adapter = upi({ gateway: 'razorpay', apiKey: '...', apiSecret: '...' });

// Reserve Pay (SBMD) — budget envelope for agents
const reservePay = new UPIReservePayManager({ gateway: 'razorpay', apiKey: '...', apiSecret: '...' });
const block = await reservePay.createBlock({ payerIdentifier: 'agent-1', amount: 500000, expiryDays: 30 });
```

See the [main documentation](../../README.md) for full details.
