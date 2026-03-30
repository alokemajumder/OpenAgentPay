# @openagentpay/adapter-mock

Simulated payment adapter for development and testing. Configurable success/failure rates.

## Install

```bash
npm install @openagentpay/adapter-mock
```

## Usage

```typescript
import { mock } from '@openagentpay/adapter-mock';

const adapter = mock({ successRate: 1.0 }); // always succeeds
```

See the [main documentation](../../README.md) for full details.
