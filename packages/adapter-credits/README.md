# @openagentpay/adapter-credits

Prepaid credit balance adapter with atomic deductions. Zero per-call fees, instant settlement.

## Install

```bash
npm install @openagentpay/adapter-credits
```

## Usage

```typescript
import { credits } from '@openagentpay/adapter-credits';

const adapter = credits({ store: new InMemoryCreditStore() });
```

See the [main documentation](../../README.md) for full details.
