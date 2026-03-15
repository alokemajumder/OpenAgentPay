# Receipts Guide

## Overview

Every agent payment generates a structured receipt — an immutable record of who paid, what was requested, how much was charged, and what was delivered. Receipts enable cost attribution, compliance auditing, and dispute resolution.

## Installation

```bash
pnpm add @openagentpay/receipts @openagentpay/core
```

## Creating a Receipt Store

```typescript
import { createReceiptStore } from '@openagentpay/receipts';

// In-memory (default)
const store = createReceiptStore();

// File-based (one JSON file per receipt)
const fileStore = createReceiptStore({
  type: 'file',
  path: './data/receipts',
});
```

## Querying Receipts

```typescript
// By payer
const agentReceipts = await store.query({ payer: '0x1234...' });

// By provider
const providerReceipts = await store.query({ payee: 'api.example.com' });

// By date range
const todayReceipts = await store.query({
  after: '2026-03-15T00:00:00Z',
  before: '2026-03-16T00:00:00Z',
});

// By payment method
const x402Receipts = await store.query({ method: 'x402' });

// By task (for cost attribution)
const taskReceipts = await store.query({ taskId: 'task_abc123' });

// Pagination
const page2 = await store.query({ limit: 50, offset: 50, order: 'desc' });
```

## Aggregated Summaries

```typescript
const summary = await store.summary();
// {
//   totalCount: 1432,
//   totalAmount: '14.32',
//   currency: 'USDC',
//   byMethod: {
//     x402: { count: 1200, amount: '12.00' },
//     credits: { count: 232, amount: '2.32' },
//   },
//   byProvider: {
//     'api.example.com': { count: 800, amount: '8.00' },
//     'data.trusted.dev': { count: 632, amount: '6.32' },
//   },
//   dateRange: {
//     earliest: '2026-03-01T...',
//     latest: '2026-03-15T...',
//   },
// }
```

## Exporting

```typescript
// JSON export
const json = await store.export({ format: 'json' });

// CSV export
const csv = await store.export({ format: 'csv' });

// Filtered export
const filteredCsv = await store.export({
  format: 'csv',
  query: { payer: '0x1234...', after: '2026-03-01T00:00:00Z' },
});
```

## Receipt Schema

Every receipt contains:

```typescript
{
  id: '01HX3KQVR8...',          // ULID (sortable, unique)
  version: '1.0',
  timestamp: '2026-03-15T...',

  payer: {
    type: 'agent',
    identifier: '0x1234...',
    agent_id: 'research-agent',
    organization_id: 'org_acme',
  },

  payee: {
    provider_id: 'weather-api',
    identifier: '0x5678...',
    endpoint: '/api/weather?city=London',
  },

  request: {
    method: 'GET',
    url: '/api/weather?city=London',
    body_hash: 'sha256:e3b0c4...',
    task_id: 'task_abc123',
  },

  payment: {
    amount: '0.01',
    currency: 'USDC',
    method: 'x402',
    transaction_hash: '0xabc...def',
    network: 'base',
    status: 'settled',
  },

  response: {
    status_code: 200,
    content_hash: 'sha256:a1b2c3...',
    content_length: 1024,
    latency_ms: 342,
  },

  policy: {
    decision: 'auto_approved',
    rules_evaluated: ['maxPerRequest', 'maxPerDay'],
    budget_remaining: '49.99',
  },
}
```

## Integration with OpenTelemetry

```typescript
import { createPaymentTracer } from '@openagentpay/otel-exporter';

const tracer = createPaymentTracer();

paywall.on('payment:received', (receipt) => {
  tracer.recordPayment(receipt);
  store.save(receipt);
});
```
