# @openagentpay/adapter-mpp

MPP (Machine Payments Protocol) adapter supporting Tempo, Stripe, and Lightning networks. Includes sessions, streaming payments, and IETF `Payment` auth scheme.

## Install

```bash
npm install @openagentpay/adapter-mpp
```

## Usage

```typescript
import { mpp, mppWallet } from '@openagentpay/adapter-mpp';

// Server
const adapter = mpp({ networks: ['tempo', 'stripe'], sessionsSupported: true });

// Client
const wallet = mppWallet({ network: 'tempo', tempoPrivateKey: process.env.KEY });
```

See the [main documentation](../../README.md) for full details.
