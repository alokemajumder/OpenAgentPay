# @openagentpay/receipts

Receipt storage, querying, and export. Supports memory and file backends with CSV/JSON export.

## Install

```bash
npm install @openagentpay/receipts
```

## Usage

```typescript
import { createReceiptStore } from '@openagentpay/receipts';

const store = createReceiptStore({ type: 'file', path: './receipts' });
await store.store(receipt);
const csv = await store.export({ format: 'csv' });
```

See the [main documentation](../../README.md) for full details.
