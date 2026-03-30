# @openagentpay/otel-exporter

OpenTelemetry spans and metrics for payment events. Track payment latency, success rates, and amounts.

## Install

```bash
npm install @openagentpay/otel-exporter
```

## Usage

```typescript
import { createPaymentTracer, createPaymentMetrics } from '@openagentpay/otel-exporter';

paywall.on('payment:received', (receipt) => {
  createPaymentTracer().recordPayment(receipt);
  createPaymentMetrics().recordPayment(receipt);
});
```

See the [main documentation](../../README.md) for full details.
