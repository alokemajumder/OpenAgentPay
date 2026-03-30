# @openagentpay/adapter-lightning

Lightning Network payment adapter using BOLT11 invoices via LND REST API. Preimage-based proof of payment.

## Install

```bash
npm install @openagentpay/adapter-lightning
```

## Usage

```typescript
import { lightning, lightningWallet } from '@openagentpay/adapter-lightning';

// Server
const adapter = lightning({ nodeUrl: 'https://lnd:8080', macaroon: '...' });

// Client
const wallet = lightningWallet({ nodeUrl: 'https://lnd:8080', macaroon: '...' });
```

See the [main documentation](../../README.md) for full details.
