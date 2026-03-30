# @openagentpay/adapter-solana

Solana SPL token payment adapter. Supports USDC and other tokens on mainnet-beta and devnet. Ed25519 signing with zero external dependencies.

## Install

```bash
npm install @openagentpay/adapter-solana
```

## Usage

```typescript
import { solana, solanaWallet } from '@openagentpay/adapter-solana';

// Server
const adapter = solana({ rpcUrl: 'https://api.mainnet-beta.solana.com' });

// Client
const wallet = solanaWallet({ privateKey: '...', rpcUrl: '...', tokenMint: 'USDC_MINT' });
```

See the [main documentation](../../README.md) for full details.
