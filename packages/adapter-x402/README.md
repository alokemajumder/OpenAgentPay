# @openagentpay/adapter-x402

x402 payment adapter for USDC on Base/Base Sepolia. Uses production secp256k1 ECDSA signing with keccak-256 and EIP-712 typed data.

## Install

```bash
npm install @openagentpay/adapter-x402
```

## Usage

```typescript
import { x402, x402Wallet } from '@openagentpay/adapter-x402';

// Server
const adapter = x402({ network: 'base', facilitatorUrl: 'https://...' });

// Client
const wallet = x402Wallet({ privateKey: '0x...', network: 'base-sepolia' });
```

See the [main documentation](../../README.md) for full details.
