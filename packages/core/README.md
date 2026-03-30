# @openagentpay/core

Zero-dependency foundation for OpenAgentPay. Provides types, schemas, builders, parsers, and error classes used by all other packages.

## Install

```bash
npm install @openagentpay/core
```

## Usage

```typescript
import { parsePaymentRequired, buildPaymentRequired } from '@openagentpay/core';
import type { PaymentMethod, AgentPaymentReceipt, PolicyConfig } from '@openagentpay/core';

// Parse a 402 response body
const parsed = parsePaymentRequired(responseBody);
console.log(parsed.pricing, parsed.methods);
```

## What's included

- **Types**: PaymentMethod, AgentPaymentReceipt, PolicyConfig, AdapterConfig, AgentDID, AgentPayDiscovery
- **Parsers**: `parsePaymentRequired()` for unified 402 response parsing
- **Builders**: `buildPaymentRequired()` for constructing 402 response bodies
- **Errors**: 10 typed error classes (PaymentRequiredError, PolicyDeniedError, etc.)

See the [main documentation](../../README.md) for full details.
