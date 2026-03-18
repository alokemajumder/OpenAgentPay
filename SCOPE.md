# OpenAgentPay — Project Scope & Progress Tracker

> **Open-Source Payment Orchestration Layer for Machine-to-Machine Commerce**
> One integration point for every agent payment method — x402, MPP, Visa, Stripe, PayPal, UPI, credits. Intelligent routing, policy enforcement, unified receipts. Not a payment processor — the experience and routing layer that connects them all.

---

## Table of Contents

- [Vision](#vision)
- [Problem Statement](#problem-statement)
- [Core Thesis](#core-thesis)
- [Architecture Overview](#architecture-overview)
- [Package Map](#package-map)
- [402 Response Standard](#402-response-standard)
- [Receipt Standard](#receipt-standard)
- [Client SDK — Agent Side](#client-sdk--agent-side)
- [Server SDK — API Provider Side](#server-sdk--api-provider-side)
- [Policy Engine](#policy-engine)
- [Payment Adapters](#payment-adapters)
- [Agent Subscriptions](#agent-subscriptions)
- [MCP Integration](#mcp-integration)
- [Examples & Demos](#examples--demos)
- [Implementation Phases](#implementation-phases)
- [Validation Milestones](#validation-milestones)
- [Risk Register](#risk-register)
- [Competitive Landscape](#competitive-landscape)
- [Open Source Strategy](#open-source-strategy)
- [Non-Goals](#non-goals)
- [Repository Structure](#repository-structure)
- [Technical Decisions](#technical-decisions)

---

## Vision

**OpenAgentPay is the payment infrastructure for the AI agent economy.**

Today, if an AI agent needs to use a paid API, a human must pre-provision an API key, manage a subscription, and reconcile invoices. This does not scale. When thousands of agents call thousands of APIs autonomously, the current model breaks.

OpenAgentPay makes it so:
1. An **API provider** adds one line of middleware → their endpoint accepts autonomous payments
2. An **AI agent** makes a request → discovers the price → pays instantly → gets the response + a receipt
3. No signup. No API key. No subscription. No invoice. Just pay and use.

This is what **Stripe did for web commerce** — remove all the friction from getting paid — but for **machine-to-machine API calls**.

---

## Problem Statement

### The World Without OpenAgentPay

```
Human provisions API key for Agent
       ↓
Agent calls API with pre-shared key
       ↓
API provider tracks usage behind the scenes
       ↓
API provider invoices human monthly
       ↓
Human pays invoice with credit card
       ↓
Repeat for every API the agent needs
```

**Problems:**
- Agent cannot discover or use a new paid API without human intervention
- Every API requires separate signup, key provisioning, and billing relationship
- No spend governance — agent can rack up unlimited charges on a pre-shared key
- No cross-provider receipts or audit trail
- Micropayments ($0.001-$0.10 per call) are uneconomical via credit card rails
- API providers must build complex billing infrastructure (accounts, keys, usage tracking, invoicing)

### The World With OpenAgentPay

```
Agent requests API
       ↓
API returns 402 Payment Required (with machine-readable price)
       ↓
Agent's policy engine checks: amount OK? domain allowed? budget remaining?
       ↓
Agent pays (stablecoin, credits, or other method)
       ↓
API verifies payment, serves response
       ↓
Both sides get a signed receipt
```

**Zero friction. Autonomous. Auditable. Instant settlement.**

---

## Core Thesis

### Why Now

1. **AI agents are proliferating.** Every major AI company is shipping agent frameworks. Multi-step autonomous workflows are going from demo to production.

2. **Micropayments are finally viable.** L2 chains (Base) have sub-cent transaction fees. Stablecoins (USDC) eliminate volatility. EIP-3009 means the agent signs but doesn't need gas.

3. **MCP is becoming the standard for agent tools.** Model Context Protocol has no payment semantics — that gap needs filling before paid MCP tools can exist.

4. **HTTP 402 was designed for this.** Reserved since 1997, finally usable thanks to x402. The protocol pattern (request → 402 → pay → retry) is native to how HTTP works.

5. **The n-squared problem.** If 100 agents need 100 APIs, that's 10,000 billing relationships to manage manually. OpenAgentPay collapses it to: every agent has a wallet, every API has a paywall. Done.

### Why Open Source

- **Payment infrastructure requires trust.** Developers won't route money through a black box.
- **Protocol adoption requires openness.** The 402 response format and receipt standard only achieve network effects if anyone can implement them.
- **Stripe won by developer trust.** We earn that by being transparent, auditable, and community-governed.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                      OpenAgentPay                             │
│                                                               │
│  ┌─────────────────────────┐    ┌───────────────────────────┐ │
│  │    SERVER (API Provider) │    │    CLIENT (AI Agent)       │ │
│  │                         │    │                           │ │
│  │  paywall() middleware   │    │  withPayment() wrapper    │ │
│  │                         │    │                           │ │
│  │  Request arrives:       │    │  Agent makes request:     │ │
│  │  ├─ Has payment proof?  │    │  ├─ Gets 200? Return it   │ │
│  │  │  ├─ Verify → serve   │    │  ├─ Gets 402?             │ │
│  │  │  └─ Invalid → 402   │    │  │  ├─ Parse pricing      │ │
│  │  └─ No payment?        │    │  │  ├─ Check policy       │ │
│  │     └─ Return 402      │    │  │  ├─ Pay                │ │
│  │        (pricing +      │    │  │  ├─ Retry with proof   │ │
│  │         methods)       │    │  │  └─ Collect receipt    │ │
│  │                         │    │  └─ Gets other? Return   │ │
│  │  After serve:           │    │                           │ │
│  │  └─ Emit receipt        │    │  Policy Engine:           │ │
│  │                         │    │  ├─ Max per request       │ │
│  │  Adapters:              │    │  ├─ Max per day           │ │
│  │  ├─ x402 (USDC)        │    │  ├─ Domain allowlist      │ │
│  │  ├─ credits             │    │  ├─ Approval threshold   │ │
│  │  └─ mock (testing)      │    │  └─ Budget tracking      │ │
│  └─────────────────────────┘    └───────────────────────────┘ │
│                                                               │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  @openagentpay/core                                       │ │
│  │  ├── PaymentRequired (402 response schema)                │ │
│  │  ├── AgentPaymentReceipt (receipt schema)                 │ │
│  │  ├── PaymentAdapter (adapter interface)                   │ │
│  │  ├── Pricing types (static, dynamic, tiered)              │ │
│  │  └── Subscription types (time-bounded, bundle, recurring) │ │
│  └───────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### The Payment Flow

```
   AI Agent                          Paid API
      │                                 │
      │  GET /api/search?q=test         │
      │────────────────────────────────►│
      │                                 │
      │  402 Payment Required           │
      │  { pricing, methods }           │
      │◄────────────────────────────────│
      │                                 │
      │  [Policy check: $0.01 OK? ✓]   │
      │  [Select method: x402]          │
      │  [Sign payment authorization]   │
      │                                 │
      │  GET /api/search?q=test         │
      │  X-PAYMENT: <signed proof>      │
      │────────────────────────────────►│
      │                                 │
      │  [Verify via facilitator ✓]     │
      │  [Execute handler]              │
      │                                 │
      │  200 OK                         │
      │  { results: [...] }             │
      │  X-RECEIPT: <receipt-id>        │
      │◄────────────────────────────────│
      │                                 │
      │  [Store receipt for audit]      │
```

---

## Package Map

| Package | Purpose | Phase | Status |
|---------|---------|-------|--------|
| `@openagentpay/core` | Types, 402 schema, receipt schema, adapter interface | Phase 1 | 🟢 Complete |
| `@openagentpay/adapter-mock` | Simulated payments for development/testing | Phase 1 | 🟢 Complete |
| `@openagentpay/server-express` | Express paywall middleware | Phase 1 | 🟢 Complete |
| `@openagentpay/client` | Fetch/Axios wrapper with auto-402 handling | Phase 2 | 🟢 Complete |
| `@openagentpay/policy` | Client-side spend governance engine | Phase 2 | 🟢 Complete |
| `@openagentpay/adapter-credits` | Prepaid credit balance system | Phase 2 | 🟢 Complete |
| `@openagentpay/adapter-x402` | x402 stablecoin payments (USDC on Base) | Phase 3 | 🟢 Complete |
| `@openagentpay/receipts` | Receipt storage, query, export | Phase 3 | 🟢 Complete |
| `@openagentpay/server-hono` | Hono paywall middleware | Phase 4 | 🟢 Complete |
| `@openagentpay/mcp` | Paid MCP tool adapter (server + client) | Phase 4 | 🟢 Complete |
| `@openagentpay/server-fastapi` | FastAPI middleware (Python) | Phase 5 | ⬜ Not Started |
| `@openagentpay/client-python` | Python client SDK | Phase 5 | ⬜ Not Started |
| `@openagentpay/otel-exporter` | OpenTelemetry payment spans | Phase 5 | 🟢 Complete |

**Status Key:** ⬜ Not Started | 🟡 In Progress | 🟢 Complete | 🔴 Blocked | ⏸️ Deferred

---

## 402 Response Standard

The machine-readable 402 response format is the most strategically important deliverable. If adopted by multiple implementations, it becomes an open standard for agent-API pricing discovery.

### Schema: `PaymentRequired`

```typescript
interface PaymentRequired {
  /** Schema identifier */
  type: 'payment_required'

  /** Schema version */
  version: '1.0'

  /** The resource being requested */
  resource: string

  /** Per-request pricing */
  pricing: {
    /** Amount as decimal string (e.g., "0.01") */
    amount: string
    /** Currency code — ISO 4217 or token symbol */
    currency: string
    /** What the amount covers */
    unit: 'per_request' | 'per_kb' | 'per_second' | 'per_unit'
    /** Human-readable description */
    description?: string
  }

  /** Available subscription plans (optional — for recurring/bulk access) */
  subscriptions?: SubscriptionPlan[]

  /** Available payment methods for per-request and subscription payments */
  methods: PaymentMethod[]

  /** Provider metadata */
  meta?: {
    provider?: string
    docs_url?: string
    tos_url?: string
    /** Subscription management endpoints */
    subscribe_url?: string
    subscription_status_url?: string
    unsubscribe_url?: string
  }
}

interface SubscriptionPlan {
  /** Plan identifier */
  id: string
  /** Cost of the subscription */
  amount: string
  /** Currency */
  currency: string
  /** Billing period */
  period: 'hour' | 'day' | 'week' | 'month'
  /** Call limit within the period (null = unlimited) */
  calls: number | 'unlimited'
  /** Rate limit (calls per minute, null = no limit) */
  rate_limit?: number | null
  /** Human-readable description */
  description?: string
  /** Whether auto-renewal is supported */
  auto_renew?: boolean
}

type PaymentMethod =
  | X402PaymentMethod
  | CreditsPaymentMethod

interface X402PaymentMethod {
  type: 'x402'
  network: string          // e.g., 'base', 'base-sepolia'
  asset: string            // e.g., 'USDC'
  asset_address: string    // token contract address
  pay_to: string           // recipient wallet address
  facilitator_url: string  // settlement service URL
  max_timeout_seconds?: number
}

interface CreditsPaymentMethod {
  type: 'credits'
  purchase_url: string     // where to buy credits
  balance_url: string      // where to check balance
}
```

### Example 402 Response

```http
HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "type": "payment_required",
  "version": "1.0",
  "resource": "/api/search",
  "pricing": {
    "amount": "0.01",
    "currency": "USDC",
    "unit": "per_request",
    "description": "Premium search query"
  },
  "subscriptions": [
    {
      "id": "hourly-unlimited",
      "amount": "0.50",
      "currency": "USDC",
      "period": "hour",
      "calls": "unlimited",
      "description": "Unlimited calls for 1 hour"
    },
    {
      "id": "daily-1000",
      "amount": "5.00",
      "currency": "USDC",
      "period": "day",
      "calls": 1000,
      "description": "1,000 calls/day — 50% savings vs per-call",
      "auto_renew": true
    },
    {
      "id": "monthly-unlimited",
      "amount": "50.00",
      "currency": "USDC",
      "period": "month",
      "calls": "unlimited",
      "description": "Unlimited monthly access",
      "auto_renew": true
    }
  ],
  "methods": [
    {
      "type": "x402",
      "network": "base",
      "asset": "USDC",
      "asset_address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "pay_to": "0x1234567890abcdef1234567890abcdef12345678",
      "facilitator_url": "https://x402.org/facilitator"
    },
    {
      "type": "credits",
      "purchase_url": "https://api.example.com/credits/buy",
      "balance_url": "https://api.example.com/credits/balance"
    }
  ],
  "meta": {
    "subscribe_url": "https://api.example.com/openagentpay/subscribe",
    "subscription_status_url": "https://api.example.com/openagentpay/subscription",
    "unsubscribe_url": "https://api.example.com/openagentpay/unsubscribe"
  }
}
```

### Progress

- [ ] Define TypeScript types in `@openagentpay/core`
- [ ] Define JSON Schema for external validation
- [ ] Write specification document (`specs/402-response.md`)
- [ ] Implement 402 response builder
- [ ] Implement 402 response parser (client-side)
- [ ] Publish spec for community review

---

## Receipt Standard

Every agent payment generates a structured, verifiable receipt. This enables cost attribution, compliance auditing, dispute resolution, and agent performance analytics.

### Schema: `AgentPaymentReceipt`

```typescript
interface AgentPaymentReceipt {
  /** Unique receipt ID (ULID — sortable, timestamp-embedded) */
  id: string

  /** Schema version */
  version: '1.0'

  /** When the payment occurred (ISO 8601) */
  timestamp: string

  /** Who paid */
  payer: {
    type: 'agent' | 'service'
    /** Wallet address or credit account ID */
    identifier: string
    /** Optional agent identity metadata */
    agent_id?: string
    organization_id?: string
  }

  /** Who was paid */
  payee: {
    /** Provider name or ID */
    provider_id?: string
    /** Wallet address */
    identifier: string
    /** The endpoint that was called */
    endpoint: string
  }

  /** What was requested */
  request: {
    method: string
    url: string
    /** SHA-256 of request body (verifiable without exposing data) */
    body_hash?: string
    /** MCP tool name, if applicable */
    tool_name?: string
    /** Workflow/task ID for cost attribution */
    task_id?: string
    session_id?: string
  }

  /** Payment details */
  payment: {
    amount: string
    currency: string
    method: 'x402' | 'credits' | 'mock'
    /** On-chain transaction hash (x402) */
    transaction_hash?: string
    network?: string
    status: 'settled' | 'pending' | 'failed'
  }

  /** Response summary (proves what was delivered) */
  response: {
    status_code: number
    /** SHA-256 of response body */
    content_hash: string
    content_length: number
    latency_ms: number
  }

  /** Policy decision log (from agent's policy engine) */
  policy?: {
    decision: 'auto_approved' | 'manual_approved' | 'budget_checked'
    rules_evaluated: string[]
    budget_remaining?: string
  }

  /** Optional cryptographic signature for non-repudiation */
  signature?: string
}
```

### Why This Matters

| Use Case | How Receipts Help |
|----------|------------------|
| **Enterprise cost attribution** | "Agent X spent $4.32 across 432 API calls on task Y" |
| **Compliance / SOC audit** | Immutable record of every autonomous spending decision |
| **Dispute resolution** | Cryptographic proof: this agent paid this amount, got this response |
| **Agent performance analytics** | Cost-per-task, cost-per-provider, spend trends |
| **Budget forecasting** | Historical spend data for capacity planning |

### Progress

- [ ] Define TypeScript types in `@openagentpay/core`
- [ ] Define JSON Schema
- [ ] Write specification document (`specs/receipt.md`)
- [ ] Implement receipt builder
- [ ] Implement receipt storage interface
- [ ] Implement in-memory receipt store
- [ ] Implement file-based receipt store
- [ ] Implement receipt query (by payer, by provider, by date range)
- [ ] Implement receipt export (JSON, CSV)

---

## Client SDK — Agent Side

The client SDK is the agent's payment capability. It wraps standard HTTP clients (fetch, axios) and transparently handles 402 responses.

### API

```typescript
import { withPayment } from '@openagentpay/client'
import { mockWallet } from '@openagentpay/adapter-mock'
// or: import { x402Wallet } from '@openagentpay/adapter-x402'

const paidFetch = withPayment(fetch, {
  wallet: mockWallet(),   // or x402Wallet({ privateKey, network })
  policy: {
    maxPerRequest: '1.00',          // never pay more than $1 per call
    maxPerDay: '50.00',             // daily budget cap
    allowedDomains: ['api.example.com', '*.trusted.dev'],
    approvalThreshold: '5.00',     // ask human above $5
  },
  onReceipt: (receipt) => {
    console.log(`Paid ${receipt.payment.amount} for ${receipt.request.url}`)
  }
})

// Usage — identical to fetch, but handles payments
const response = await paidFetch('https://api.example.com/search?q=test')
const data = await response.json()
```

### What Happens Under the Hood

```
paidFetch('https://api.example.com/search?q=test')
  │
  ├─ fetch(url) → response
  │
  ├─ response.status === 200? → return response (free endpoint)
  │
  ├─ response.status === 402?
  │   │
  │   ├─ Parse PaymentRequired body
  │   │   → { pricing: { amount: "0.01", currency: "USDC" }, methods: [...] }
  │   │
  │   ├─ Policy check
  │   │   ├─ $0.01 ≤ maxPerRequest ($1.00)? ✓
  │   │   ├─ dailyTotal + $0.01 ≤ maxPerDay ($50.00)? ✓
  │   │   ├─ api.example.com in allowedDomains? ✓
  │   │   ├─ $0.01 < approvalThreshold ($5.00)? ✓ (no approval needed)
  │   │   └─ All checks pass → proceed
  │   │
  │   ├─ Select payment method
  │   │   → wallet supports x402? Yes → use x402
  │   │
  │   ├─ Execute payment
  │   │   → wallet.pay(x402Method, pricing) → { header: 'X-PAYMENT', value: '...' }
  │   │
  │   ├─ Retry request with payment
  │   │   → fetch(url, { headers: { 'X-PAYMENT': '...' } })
  │   │
  │   ├─ Build receipt from payment + response
  │   │   → call onReceipt()
  │   │
  │   └─ Return response
  │
  └─ Other status? → return response (not a payment issue)
```

### Progress

- [ ] Define client config types
- [ ] Implement `withPayment` wrapper for fetch
- [ ] Implement `withPayment` wrapper for axios
- [ ] Implement 402 response parser and validator
- [ ] Implement payment method selection (match wallet to available methods)
- [ ] Implement retry with payment proof header
- [ ] Implement receipt collection
- [ ] Implement daily spend tracking (in-memory)
- [ ] Write unit tests
- [ ] Write integration tests (client + server end-to-end)

---

## Server SDK — API Provider Side

The server SDK lets API providers accept agent payments with minimal code. One middleware call per route.

### API

```typescript
import { createPaywall } from '@openagentpay/server-express'
import { x402 } from '@openagentpay/adapter-x402'
import { mock } from '@openagentpay/adapter-mock'

const paywall = createPaywall({
  recipient: '0x1234...',      // where payments go
  adapters: [
    process.env.NODE_ENV === 'test' ? mock() : x402({ network: 'base' }),
  ],
  receipts: { store: 'file', path: './receipts' },
})

// Static price
app.get('/api/search', paywall({ price: '0.01' }), searchHandler)

// Dynamic price (function of request)
app.post('/api/transcode', paywall((req) => ({
  price: calculatePrice(req.body.format, req.body.duration),
  description: `Transcode ${req.body.format}`,
})), transcodeHandler)

// Listen for payments
paywall.on('payment:received', (receipt) => {
  console.log(`Earned ${receipt.payment.amount} USDC`)
})
```

### What the Middleware Does

```
Incoming Request
       │
       ▼
┌─ Resolve pricing ─────────────────────────────────────────┐
│  Static config? → use directly                           │
│  Function? → call with request → get price               │
└───────────────────────────────────────────────────────────┘
       │
       ▼
┌─ Try each adapter ────────────────────────────────────────┐
│  adapter.detect(req) → does this request carry payment?  │
│    Yes → adapter.verify(req, pricing)                    │
│      Valid → call next() (run handler) → emit receipt    │
│      Invalid → return 402 with error details             │
│    No → try next adapter                                 │
└───────────────────────────────────────────────────────────┘
       │ (no adapter matched)
       ▼
┌─ Return 402 ──────────────────────────────────────────────┐
│  Build PaymentRequired response                          │
│  Include pricing + all available payment methods          │
│  Return HTTP 402                                          │
└───────────────────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| **No account/signup required** | Payment is per-request, not per-customer | This is the core value: any agent can pay without onboarding |
| **Middleware, not gateway** | Runs inside your app, not in front of it | No infrastructure to deploy; works with existing deployments |
| **Adapter pattern** | Payment methods are pluggable | Start with mock → add x402 → add credits → future-proof |
| **Dynamic pricing** | Price can be a function of the request | Real APIs need variable pricing (image size, compute time, data freshness) |
| **Receipts are automatic** | Every verified payment generates a receipt | Audit trail without extra code |

### Progress

- [ ] Define middleware config types
- [ ] Implement `createPaywall` factory
- [ ] Implement static pricing handler
- [ ] Implement dynamic pricing handler (function)
- [ ] Implement adapter detection + verification loop
- [ ] Implement 402 response builder
- [ ] Implement receipt generation (post-response)
- [ ] Implement event system (payment:received, payment:failed)
- [ ] Implement Express middleware wrapper
- [ ] Implement nonce tracking (replay protection)
- [ ] Write unit tests (≥80% coverage)
- [ ] Write integration tests

---

## Policy Engine

The policy engine is the agent's **safety layer**. It runs client-side and decides whether a payment should be approved before it's executed. This is the critical differentiator vs. raw x402 — autonomous spending without governance is dangerous.

### Rules

| Rule | Type | Description | Default |
|------|------|-------------|---------|
| `maxPerRequest` | `string` | Max payment for a single call | No limit |
| `maxPerDay` | `string` | Max total spend in 24h rolling window | No limit |
| `maxPerSession` | `string` | Max spend in current session | No limit |
| `maxPerProvider` | `string` | Max spend per unique domain per day | No limit |
| `allowedDomains` | `string[]` | Glob patterns for approved domains | All |
| `blockedDomains` | `string[]` | Glob patterns for blocked domains | None |
| `allowedCurrencies` | `string[]` | Which currencies agent can pay with | All |
| `approvalThreshold` | `string` | Amount above which human approval is required | No threshold |
| `maxSubscription` | `string` | Maximum commitment for auto-subscribe | No limit |
| `autoSubscribe` | `boolean` | Allow auto-optimization to subscriptions | `false` |
| `maxSubscriptionPeriod` | `string` | Longest subscription period allowed | `'month'` |
| `testMode` | `boolean` | Only allow mock payments (no real money) | `false` |

### Policy Decision Flow

```
Payment request: $0.50 to api.example.com
       │
       ├─ testMode? → only mock adapter allowed
       ├─ blockedDomains match? → DENY
       ├─ allowedDomains match? → if not matched → DENY
       ├─ allowedCurrencies include USDC? → if not → DENY
       ├─ $0.50 ≤ maxPerRequest? → if not → DENY
       ├─ dailyTotal + $0.50 ≤ maxPerDay? → if not → DENY
       ├─ sessionTotal + $0.50 ≤ maxPerSession? → if not → DENY
       ├─ providerTotal + $0.50 ≤ maxPerProvider? → if not → DENY
       ├─ $0.50 ≥ approvalThreshold? → if yes → REQUEST HUMAN APPROVAL
       │
       └─ All checks pass → APPROVE
```

### Why This Is Critical

Without the policy engine, an agent with a funded wallet is a liability:
- A malicious API could charge $100 per call
- A prompt injection attack could direct the agent to pay an attacker
- A bug could cause infinite retry loops draining the wallet
- No one would trust an agent with spending authority

The policy engine is what makes agent payments **safe enough for production.**

### Progress

- [ ] Define policy config types
- [ ] Implement rule evaluation engine
- [ ] Implement daily spend tracker (in-memory rolling window)
- [ ] Implement session spend tracker
- [ ] Implement per-provider spend tracker
- [ ] Implement domain glob matching (allowlist + blocklist)
- [ ] Implement currency filter
- [ ] Implement approval threshold with callback hook
- [ ] Implement test mode enforcement
- [ ] Write unit tests (100% coverage — this is safety-critical)

---

## Payment Adapters

### Adapter Interface

```typescript
interface PaymentAdapter {
  /** Adapter identifier */
  readonly type: string

  // --- Server-side methods ---

  /** Does this request contain a payment for this adapter? */
  detect(req: IncomingRequest): boolean

  /** Verify the payment is valid and sufficient */
  verify(req: IncomingRequest, pricing: Pricing): Promise<VerifyResult>

  /** Generate the payment method block for the 402 response */
  describeMethod(config: AdapterConfig): PaymentMethod

  // --- Client-side methods ---

  /** Execute a payment for the given requirements */
  pay(method: PaymentMethod, pricing: Pricing): Promise<PaymentProof>

  /** Check if this adapter can handle the given payment method */
  supports(method: PaymentMethod): boolean
}

interface VerifyResult {
  valid: boolean
  /** Partial receipt data from verification */
  receipt?: Partial<AgentPaymentReceipt>
  error?: string
}

interface PaymentProof {
  /** HTTP header name to attach */
  header: string
  /** HTTP header value (the proof) */
  value: string
}
```

### Adapter Implementations

#### `adapter-mock` (Phase 1)
For development and testing. No real money moves.

| Method | Behavior |
|--------|----------|
| `detect` | Checks for `X-PAYMENT: mock:<nonce>` header |
| `verify` | Always returns valid + generates mock receipt |
| `pay` | Generates `mock:<random-nonce>` proof |
| `supports` | Returns true for any method (testing all flows) |

**Progress:**
- [ ] Implement mock adapter
- [ ] Write tests

#### `adapter-credits` (Phase 2)
Prepaid balance system. Agent buys credits, spends them per-call.

| Method | Behavior |
|--------|----------|
| `detect` | Checks for `X-CREDITS: <account>:<signature>` header |
| `verify` | Validates signature, checks balance ≥ price, deducts atomically |
| `pay` | Signs credit deduction authorization |
| `supports` | Returns true for `type: 'credits'` methods |

**Progress:**
- [ ] Define credit store interface
- [ ] Implement in-memory credit store
- [ ] Implement credit purchase endpoint helper
- [ ] Implement credit balance check endpoint helper
- [ ] Implement adapter (detect, verify, pay, supports)
- [ ] Write tests

#### `adapter-x402` (Phase 3)
Real stablecoin payments via the x402 protocol. USDC on Base.

| Method | Behavior |
|--------|----------|
| `detect` | Checks for `X-PAYMENT` header with EIP-712 signed data |
| `verify` | Forwards to facilitator for on-chain verification + settlement |
| `pay` | Constructs EIP-3009 `transferWithAuthorization`, signs with agent wallet |
| `supports` | Returns true for `type: 'x402'` methods on supported networks |

**Key implementation concerns:**
- **Replay protection:** Nonce tracking to prevent payment reuse
- **Facilitator timeout:** Graceful handling if facilitator is slow/down
- **Insufficient balance:** Clear error when agent wallet is underfunded
- **Gas estimation:** Verify facilitator can settle within fee tolerance

**Progress:**
- [ ] Implement EIP-712 typed data construction
- [ ] Implement EIP-3009 transferWithAuthorization signing
- [ ] Implement facilitator API client (verify + settle)
- [ ] Implement nonce store interface
- [ ] Implement in-memory nonce store
- [ ] Implement adapter (detect, verify, pay, supports)
- [ ] Write tests
- [ ] Test on Base Sepolia testnet
- [ ] Document wallet setup for agents

---

## Agent Subscriptions

Agent subscriptions are fundamentally different from human subscriptions. Agents are rational economic actors that should auto-optimize their payment strategy based on usage patterns.

### Why Agents Need Subscriptions

| Scenario | Per-Call Cost | Daily Calls | Daily Total | Subscription | Savings |
|----------|-------------|-------------|-------------|-------------|---------|
| Stock monitor (5min interval) | $0.01 | 288 | $2.88 | $1.50/day | 48% |
| Weather polling (50 cities/hr) | $0.005 | 1,200 | $6.00 | $3.00/day | 50% |
| Security scan (continuous) | $0.02 | 500 | $10.00 | $25.00/month | 92% |
| RAG pipeline (per session) | $0.01 | 2,000 | $20.00 | $8.00/day | 60% |

Agents calling the same API repeatedly should subscribe — the SDK should make this automatic.

### Agent vs. Human Subscriptions

| Aspect | Human Subscription | Agent Subscription |
|--------|-------------------|-------------------|
| Duration | Monthly/yearly | Hours to months (task-dependent) |
| Signup | Web form, credit card | API call with payment proof |
| Decision | Emotional, habitual | Calculated cost optimization |
| Cancellation | Manual (often forgotten) | Automatic on task completion or idle |
| Volume | 1 person = few subscriptions | 1 agent = potentially 50+ across providers |
| Renewal | Default: renew forever | Default: renew only while task is active |
| Identity | Email + name | Wallet address |

### Subscription Plans (Server Side)

```typescript
const paywall = createPaywall({
  recipient: '0x...',
  adapters: [x402({ ... })],
  subscriptions: {
    plans: [
      {
        id: 'hourly-unlimited',
        amount: '0.50',
        currency: 'USDC',
        period: 'hour',
        calls: 'unlimited',
        autoRenew: false,         // one-time by default
      },
      {
        id: 'daily-1000',
        amount: '5.00',
        currency: 'USDC',
        period: 'day',
        calls: 1000,
        rateLimit: 100,           // max 100 calls/minute
        autoRenew: true,
      },
      {
        id: 'monthly-unlimited',
        amount: '50.00',
        currency: 'USDC',
        period: 'month',
        calls: 'unlimited',
        autoRenew: true,
      },
    ],
    store: 'memory',  // or 'redis', 'postgres', custom SubscriptionStore
  }
})

// Auto-registered endpoints:
// POST /openagentpay/subscribe      → pay + activate subscription
// GET  /openagentpay/subscription   → check status, usage, expiry
// POST /openagentpay/unsubscribe    → cancel (immediate or end-of-period)
// POST /openagentpay/renew          → manually renew (for auto_renew: false plans)
```

### Subscription Payment Flow

```
Agent                                      API Provider
  │                                             │
  │  GET /api/data                              │
  │────────────────────────────────────────────►│
  │                                             │
  │  402 { pricing: $0.01/call,                 │
  │        subscriptions: [                     │
  │          { daily-1000: $5/day },            │
  │          { monthly: $50/month }             │
  │        ],                                   │
  │        meta: { subscribe_url: "..." } }     │
  │◄────────────────────────────────────────────│
  │                                             │
  │  [Agent estimates: ~800 calls today         │
  │   Per-call: $8.00                           │
  │   Daily sub: $5.00 → 37% savings           │
  │   Policy: $5.00 ≤ maxPerDay ($20) ✓        │
  │   Decision: SUBSCRIBE to daily-1000]        │
  │                                             │
  │  POST /openagentpay/subscribe               │
  │  { plan: "daily-1000",                      │
  │    X-PAYMENT: <$5 payment proof> }          │
  │────────────────────────────────────────────►│
  │                                             │
  │  200 { subscription_id: "sub_abc123",       │
  │        token: "tok_xyz789",                 │
  │        expires_at: "2026-03-16T...",        │
  │        calls_remaining: 1000 }              │
  │◄────────────────────────────────────────────│
  │                                             │
  │  GET /api/data                              │
  │  X-SUBSCRIPTION: tok_xyz789                 │
  │────────────────────────────────────────────►│
  │                                             │
  │  200 { data: [...] }                        │
  │◄────────────────────────────────────────────│
  │                                             │
  │  [...repeat 800+ times, no payment...]      │
  │                                             │
  │  [Task complete → auto-cancel]              │
  │  POST /openagentpay/unsubscribe             │
  │  X-SUBSCRIPTION: tok_xyz789                 │
  │────────────────────────────────────────────►│
```

### Client-Side Auto-Optimization

The client SDK should intelligently switch between per-call and subscription:

```typescript
const paidFetch = withPayment(fetch, {
  wallet: x402Wallet({ ... }),
  policy: {
    maxPerDay: '20.00',
    maxPerRequest: '1.00',
  },
  subscription: {
    /** Automatically subscribe when it saves money */
    autoOptimize: true,
    /** Max single subscription commitment */
    maxCommitment: '50.00',
    /** Prefer shorter commitments (less risk) */
    preferredPeriod: 'day',
    /** Cancel if no calls made within this window */
    autoCancelOnIdle: '1h',
    /** Minimum savings % to trigger auto-subscribe (default: 20%) */
    savingsThreshold: 0.20,
  }
})
```

**Auto-optimization logic:**
1. Start with per-call payments
2. Track call frequency per provider (rolling window)
3. After each payment, compare: `projected per-call cost` vs `cheapest subscription`
4. If subscription saves ≥ `savingsThreshold` → auto-subscribe
5. Switch subsequent requests to use subscription token
6. If idle for `autoCancelOnIdle` → auto-cancel subscription
7. If subscription expires and task is still active → auto-renew (if plan allows and policy permits)

### Subscription Token Verification (Server Side)

The middleware checks subscriptions before payment:

```
Request with X-SUBSCRIPTION header
       │
       ▼
┌─ Validate token ──────────────────────────────────────┐
│  Token exists in store?                               │
│  Token not expired?                                   │
│  Calls remaining > 0 (or unlimited)?                  │
│  Rate limit not exceeded?                             │
│    All yes → serve request, decrement call counter    │
│    Any no → return 402 (subscription expired/exceeded)│
└───────────────────────────────────────────────────────┘
```

### Auto-Renewal (On-Chain)

For `autoRenew: true` subscriptions with x402 payments:

1. Agent signs a **pre-authorization** for recurring payments when subscribing
2. Pre-auth specifies: max amount, max renewals, renewal interval
3. Server submits renewal payment via facilitator at period end
4. If renewal fails (insufficient balance, revoked auth) → subscription ends
5. Agent receives renewal receipt

```typescript
// Pre-authorization signed at subscribe time
interface SubscriptionPreAuth {
  /** Maximum amount per renewal */
  maxAmount: string
  /** Maximum number of auto-renewals (0 = unlimited) */
  maxRenewals: number
  /** Renewal interval matches plan period */
  period: 'hour' | 'day' | 'week' | 'month'
  /** Agent can revoke at any time */
  revocable: true
}
```

### Subscription Store Interface

```typescript
interface SubscriptionStore {
  /** Create a new subscription */
  create(sub: Subscription): Promise<Subscription>
  /** Get subscription by token */
  getByToken(token: string): Promise<Subscription | null>
  /** Get active subscriptions for a payer */
  getByPayer(payerIdentifier: string): Promise<Subscription[]>
  /** Decrement call counter (atomic) */
  decrementCalls(token: string): Promise<{ remaining: number | 'unlimited' }>
  /** Check rate limit */
  checkRateLimit(token: string): Promise<boolean>
  /** Cancel subscription */
  cancel(token: string): Promise<void>
  /** Renew subscription (extend expiry, reset call counter) */
  renew(token: string): Promise<Subscription>
  /** List expired subscriptions pending renewal */
  listExpiring(before: Date): Promise<Subscription[]>
}
```

### Progress

- [ ] Define subscription plan types in `@openagentpay/core`
- [ ] Define subscription store interface
- [ ] Implement in-memory subscription store
- [ ] Implement subscribe endpoint handler
- [ ] Implement subscription status endpoint
- [ ] Implement unsubscribe endpoint
- [ ] Implement renewal endpoint
- [ ] Integrate subscription token check into paywall middleware
- [ ] Implement client-side auto-optimization logic
- [ ] Implement call frequency tracker (rolling window)
- [ ] Implement auto-cancel on idle
- [ ] Implement pre-authorization for auto-renewal (x402)
- [ ] Write unit tests for subscription lifecycle
- [ ] Write integration tests (subscribe → use → renew → cancel)
- [ ] Add subscription to paid-weather-api example

---

## MCP Integration

### The Opportunity
MCP (Model Context Protocol) is becoming the standard for AI agent tool interaction. The MCP spec has **zero payment semantics** — no way to declare that a tool costs money, no way for a client to pay for a tool invocation. OpenAgentPay fills this gap.

### Paid MCP Tool (Server)

```typescript
import { paidTool } from '@openagentpay/mcp'
import { x402 } from '@openagentpay/adapter-x402'

const server = new MCPServer()

server.tool('premium-search',
  paidTool({
    price: '0.01',
    currency: 'USDC',
    adapters: [x402({ network: 'base', recipient: '0x...' })],
  },
  async (params) => {
    return { results: await deepSearch(params.query) }
  })
)
```

### MCP Client with Payment (Agent)

```typescript
import { withMCPPayment } from '@openagentpay/mcp'
import { x402Wallet } from '@openagentpay/adapter-x402'

const client = withMCPPayment(mcpClient, {
  wallet: x402Wallet({ privateKey: process.env.AGENT_WALLET_KEY }),
  policy: { maxPerCall: '0.10', maxPerDay: '5.00' },
})

// Tool requires payment → client handles it transparently
const result = await client.callTool('premium-search', { query: 'AI trends' })
```

### Progress

- [ ] Research MCP tool invocation lifecycle (where payment fits)
- [ ] Design payment signaling within MCP tool responses
- [ ] Implement `paidTool` server wrapper
- [ ] Implement `withMCPPayment` client wrapper
- [ ] Write example: paid MCP weather tool
- [ ] Write tests
- [ ] Document MCP integration patterns

---

## Examples & Demos

| # | Example | Description | Packages Used | Phase |
|---|---------|-------------|---------------|-------|
| 1 | `paid-weather-api` | Express API that charges $0.005 per weather query | server-express, adapter-mock | Phase 1 |
| 2 | `agent-client` | Agent that discovers pricing and pays for API calls | client, policy, adapter-mock | Phase 2 |
| 3 | `end-to-end-demo` | Server + Client + Receipts in one runnable script | All Phase 1-3 packages | Phase 3 |
| 4 | `paid-ffmpeg-api` | Video transcoding with dynamic pricing based on format/duration | server-express, adapter-x402 | Phase 3 |
| 5 | `paid-mcp-server` | MCP tool that charges per invocation | mcp, adapter-mock | Phase 4 |
| 6 | `multi-agent-workflow` | Agent orchestrating across multiple paid APIs | client, policy, receipts | Phase 4 |

### The 60-Second Demo (Phase 1 Target)

```bash
# Terminal 1: Start paid API server
npx @openagentpay/example-server
# → "Paid weather API running on http://localhost:3000"
# → "GET /api/weather?city=London → $0.005 per request (mock payments)"

# Terminal 2: Call without payment
curl http://localhost:3000/api/weather?city=London
# → 402 Payment Required
# → { "type": "payment_required", "pricing": { "amount": "0.005" }, ... }

# Terminal 3: Call with paying agent
npx @openagentpay/example-client "http://localhost:3000/api/weather?city=London"
# → "Policy check: $0.005 ≤ max ($1.00) ✓"
# → "Payment: $0.005 USDC (mock)"
# → "Response: { temp: 15, condition: 'cloudy' }"
# → "Receipt: oap_01HX3KQVR8... saved"
```

### Progress

- [ ] paid-weather-api (Phase 1)
- [ ] agent-client (Phase 2)
- [ ] end-to-end-demo (Phase 3)
- [ ] paid-ffmpeg-api (Phase 3)
- [ ] paid-mcp-server (Phase 4)
- [ ] multi-agent-workflow (Phase 4)

---

## Implementation Phases

### Phase 1: Core + Mock — Working Demo (Week 1-2)
> **Goal:** A working paywall that returns 402, accepts mock payment, and generates receipts. Zero external dependencies. Zero crypto.

| # | Deliverable | Status |
|---|-------------|--------|
| 1.1 | Monorepo setup (Turborepo + pnpm + Vitest + Biome) | 🟢 |
| 1.2 | `@openagentpay/core` — all TypeScript types and interfaces | 🟢 |
| 1.3 | `@openagentpay/core` — 402 response builder | 🟢 |
| 1.4 | `@openagentpay/core` — receipt builder | 🟢 |
| 1.5 | `@openagentpay/adapter-mock` — full adapter implementation | 🟢 |
| 1.6 | `@openagentpay/server-express` — paywall middleware | 🟢 |
| 1.7 | `examples/paid-weather-api` — working demo | 🟢 |
| 1.8 | Unit tests (≥80% coverage) | ⬜ |
| 1.9 | README with quickstart + architecture diagram | 🟢 |
| 1.10 | Publish to npm (v0.1.0) | ⬜ |

**Exit Criteria:** `npm install` → add paywall to route → curl gets 402 → client with mock pays → gets response.

---

### Phase 2: Client SDK + Policy + Credits (Week 3-4)
> **Goal:** Agents can discover, evaluate, and pay for APIs. Policy engine prevents runaway spending.

| # | Deliverable | Status |
|---|-------------|--------|
| 2.1 | `@openagentpay/client` — fetch wrapper with auto-402 | 🟢 |
| 2.2 | `@openagentpay/policy` — spend governance engine | 🟢 |
| 2.3 | `@openagentpay/adapter-credits` — prepaid balance adapter | 🟢 |
| 2.4 | `examples/agent-client` — agent paying for APIs | 🟢 |
| 2.5 | Integration tests (client ↔ server) | ⬜ |
| 2.6 | Publish v0.2.0 | ⬜ |

**Exit Criteria:** Agent makes request → gets 402 → policy approves → pays with credits → gets response → receipt generated on both sides.

---

### Phase 3: x402 + Real Payments (Week 5-6)
> **Goal:** Real stablecoin payments on testnet. First true "Stripe for AI agents" moment.

| # | Deliverable | Status |
|---|-------------|--------|
| 3.1 | `@openagentpay/adapter-x402` — USDC on Base Sepolia | 🟢 |
| 3.2 | `@openagentpay/receipts` — storage + query + export | 🟢 |
| 3.3 | Nonce/replay protection | 🟢 |
| 3.4 | Subscription system — plans, subscribe/unsubscribe/renew endpoints | 🟢 |
| 3.5 | Subscription token verification in paywall middleware | 🟢 |
| 3.6 | Client-side auto-optimize (per-call → subscription switching) | ⬜ |
| 3.7 | `examples/end-to-end-demo` — full real-payment flow | 🟢 |
| 3.8 | `examples/paid-ffmpeg-api` — dynamic pricing + subscription | ⬜ |
| 3.9 | Testnet deployment guide | ⬜ |
| 3.10 | Publish v0.3.0 | ⬜ |

**Exit Criteria:** Agent pays 0.01 USDC on Base Sepolia → API verifies → serves response → receipt with on-chain tx hash. Agent auto-subscribes when per-call is more expensive than subscription.

---

### Phase 4: Hono + MCP + Spec Documents (Week 7-8)
> **Goal:** MCP integration and formal specification documents for community review.

| # | Deliverable | Status |
|---|-------------|--------|
| 4.1 | `@openagentpay/server-hono` — Hono middleware | 🟢 |
| 4.2 | `@openagentpay/mcp` — paid MCP tool wrapper | 🟢 |
| 4.3 | `examples/paid-mcp-server` | ⬜ |
| 4.4 | `examples/multi-agent-workflow` | ⬜ |
| 4.5 | `specs/402-response.md` — formal specification | 🟢 |
| 4.6 | `specs/receipt.md` — formal specification | 🟢 |
| 4.7 | Full documentation (getting-started, concepts, guides) | 🟢 |
| 4.8 | Publish v0.4.0 | ⬜ |

**Exit Criteria:** MCP tool charges per invocation. Agent with MCP client auto-pays. Spec documents published for community feedback.

---

### Phase 5: Python + Ecosystem + Launch (Week 9-12)
> **Goal:** Multi-language support, ecosystem integrations, and public launch.

| # | Deliverable | Status |
|---|-------------|--------|
| 5.1 | `@openagentpay/server-fastapi` — Python middleware | ⬜ |
| 5.2 | `@openagentpay/client-python` — Python client | ⬜ |
| 5.3 | `@openagentpay/otel-exporter` — OpenTelemetry spans | 🟢 |
| 5.4 | CLI: `npx openagentpay receipts list\|export\|inspect` | ⬜ |
| 5.5 | Mainnet deployment guide (Base mainnet) | ⬜ |
| 5.6 | Launch blog post | ⬜ |
| 5.7 | Publish v1.0.0 | ⬜ |

**Exit Criteria:** TypeScript + Python SDKs published. Receipts export to OpenTelemetry. Production-ready on Base mainnet. Public launch.

---

## Validation Milestones

Go/no-go checkpoints to determine if the project has real traction.

| Milestone | Target | Metric | Decision |
|-----------|--------|--------|----------|
| Phase 1 ships | Week 2 | Working demo on npm | Continue to Phase 2 |
| First external GitHub issue | Month 1 | ≥1 issue from non-author | Signal of interest |
| 50 GitHub stars | Month 1 | Stars | Continue |
| 100 npm installs/week | Month 2 | npm download stats | Continue |
| First external contributor | Month 2 | ≥1 merged PR from non-author | Strong signal |
| 250 GitHub stars | Month 3 | Stars | Continue |
| 1 production MCP tool using it | Month 4 | Confirmed real usage | **Project is validated** |
| 500 stars + 10 contributors | Month 6 | Community health | **Path to significance** |
| MCP community feedback on spec | Month 6 | Engagement | **Path to standard** |
| **< 20 stars at Month 3** | Month 3 | Stars | **Pivot or pause** |

---

## Risk Register

| # | Risk | Likelihood | Impact | Mitigation | Owner |
|---|------|-----------|--------|------------|-------|
| R1 | Agent economy too early — agents don't transact autonomously yet | Medium | High | Build for inevitable future; validate with early adopters | — |
| R2 | x402 protocol abandoned by Coinbase | Medium | Medium | Adapter pattern: x402 is swappable; core is protocol-agnostic | — |
| R3 | Stripe builds agent payment capability | Medium | High | Be the open-source standard layer; make Stripe an adapter, not competitor | — |
| R4 | Developers avoid crypto-associated projects | High | Medium | Phase 1-2 are 100% crypto-free; crypto is opt-in | — |
| R5 | Micropayments fail again (30-year historical pattern) | Medium | High | Different this time: payer is software (no mental transaction cost), fees under $0.001 | — |
| R6 | MCP spec breaks backward compatibility | Medium | Medium | MCP adapter is separate optional package; core is HTTP-native | — |
| R7 | Security vulnerability: payment replay/drain | Medium | Critical | Nonce tracking, policy engine, spend limits, security audit pre-v1.0 | — |
| R8 | Regulatory action against stablecoin payments | Low-Med | High | We don't custody funds; support fiat adapters as fallback | — |
| R9 | No contributors (bus factor = 1) | High | High | Good docs, good-first-issues, responsive to PRs, community building | — |
| R10 | Prompt injection → agent pays attacker | Medium | Critical | Policy engine: domain allowlist, amount caps, approval thresholds | — |
| R11 | Facilitator centralization (Coinbase dependency) | Medium | Medium | Support self-hosted facilitators; build facilitator-agnostic interface | — |
| R12 | Payment latency too high for real-time APIs | Low-Med | Medium | L2 settlement in seconds; future: optimistic serving with async settlement | — |

---

## Competitive Landscape

| Project | Type | Focus | OSS? | Our Differentiation |
|---------|------|-------|------|---------------------|
| **coinbase/x402** | Protocol | HTTP 402 payment standard | Yes | We add policy, receipts, client SDK, and developer UX on top |
| **Stripe Agent Toolkit** | SDK | Stripe API access for agents | Yes | We're payment-agnostic; they're Stripe-locked |
| **Skyfire Network** | Platform | Commercial agent payments | No | We're open source and auditable |
| **PaymanAI** | Platform | Fiat agent payments | No | We're open source and protocol-level |
| **Nevermined** | Marketplace | Agent-to-agent marketplace | Partial | We're infrastructure, not marketplace |
| **L402 / Lightning** | Protocol | Bitcoin micropayments via 402 | Yes | We support stablecoins (no volatility), multi-method |

### Our Unique Position

**Nobody else provides: client SDK + server middleware + policy engine + receipt standard + MCP adapter as a cohesive open-source toolkit.**

x402 is a protocol. Stripe is a processor. Skyfire is a platform. OpenAgentPay is the **developer toolkit** that makes agent payments practical.

---

## Open Source Strategy

### License
**Apache 2.0** — permissive, enterprise-friendly, no patent traps.

### Forever Open Source
- All SDKs (client + server, TypeScript + Python)
- All payment adapters
- Policy engine
- Receipt schema and specification
- MCP adapter
- CLI tools
- All examples and documentation

### Potential Future Commercial Offerings (NOT in scope for v1)
- Hosted receipt explorer dashboard
- Managed facilitator service
- Enterprise policy manager with RBAC
- Analytics / cost attribution dashboard
- Provider discovery registry
- Fraud/anomaly detection on agent spending

### Governance
- **Now → 10 contributors:** BDFL (maintainer decides)
- **10+ contributors:** Core team with RFC process
- **Multi-company adoption:** Consider OpenJS Foundation or similar

---

## Non-Goals

Things OpenAgentPay explicitly does NOT do:

1. **Not a payment processor.** We don't move money. We integrate with processors.
2. **Not a wallet.** We don't store funds. We interface with wallets.
3. **Not an API gateway.** We don't handle routing, load balancing, or SSL.
4. **Not a developer portal.** No signup pages, dashboards, or docs hosting.
5. **Not a blockchain project.** Blockchain is one adapter. Core is HTTP.
6. **Not a marketplace.** We don't list or discover APIs.
7. **Not a compliance solution.** We provide receipts, not KYC/AML/tax.
8. **Not a billing replacement.** We don't replace Stripe for subscription billing. We enable a new payment channel.

---

## Repository Structure

```
openagentpay/
├── packages/
│   ├── core/                    # Types, schemas, builders
│   ├── adapter-mock/            # Development/testing adapter
│   ├── adapter-credits/         # Prepaid balance adapter
│   ├── adapter-x402/            # x402 stablecoin adapter
│   ├── server-express/          # Express paywall middleware
│   ├── server-hono/             # Hono paywall middleware
│   ├── server-fastapi/          # FastAPI middleware (Python)
│   ├── client/                  # TypeScript client SDK
│   ├── client-python/           # Python client SDK
│   ├── policy/                  # Spend governance engine
│   ├── receipts/                # Receipt storage + query
│   ├── mcp/                     # MCP paid tool adapter
│   └── otel-exporter/           # OpenTelemetry integration
│
├── examples/
│   ├── paid-weather-api/
│   ├── agent-client/
│   ├── end-to-end-demo/
│   ├── paid-ffmpeg-api/
│   ├── paid-mcp-server/
│   └── multi-agent-workflow/
│
├── specs/
│   ├── 402-response.md          # 402 Payment Required format spec
│   └── receipt.md               # Agent Payment Receipt spec
│
├── docs/
│   ├── getting-started.md
│   ├── concepts.md
│   ├── server-sdk.md
│   ├── client-sdk.md
│   ├── payment-adapters.md
│   ├── policy-engine.md
│   ├── receipts.md
│   └── mcp-integration.md
│
├── turbo.json
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
├── LICENSE                      # Apache 2.0
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── CHANGELOG.md
├── SCOPE.md                     # ← This file
└── README.md
```

---

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Monorepo | Turborepo + pnpm workspaces | Atomic changes, shared types, single CI pipeline |
| Language | TypeScript (primary), Python (Phase 5) | Agent ecosystem is predominantly TS/Python |
| Module format | ESM + CJS dual publish | Maximum compatibility |
| Testing | Vitest | Fast, TS-native, excellent monorepo support |
| Linting | Biome | Single tool for format + lint, 10x faster than ESLint |
| CI | GitHub Actions | Free for OSS, industry standard |
| Versioning | Changesets | Monorepo-aware, generates changelogs |
| First chain | Base Sepolia → Base mainnet | Lowest fees ($0.001), Coinbase x402 alignment |
| Receipt IDs | ULID | Sortable by time, URL-safe, unique |
| Nonce storage | In-memory (v1) → pluggable store | Simple start, Redis/DB later |
| 402 schema | Custom (OpenAgentPay format) | x402's format is x402-specific; ours is method-agnostic |
| Subscription tokens | Signed JWT (short-lived) | Stateless verification possible, expiry built-in |
| Auto-renewal | EIP-3009 pre-auth | Agent signs once, server renews without agent interaction |

---

## Stripe-Grade Product Standards

If Stripe were building this, every detail would be obsessively polished. OpenAgentPay must hold itself to the same bar.

### Developer Experience Principles

1. **Time to first payment < 5 minutes.** From `npm install` to a working payment flow in a single terminal session. No wallet setup, no blockchain config, no accounts — mock adapter handles everything.

2. **Copy-paste examples that work.** Every code snippet in docs must be runnable. Not "conceptual" — actual working code. Test every example in CI.

3. **Error messages that teach.** Every error must say: (a) what went wrong, (b) why, (c) how to fix it, (d) link to relevant docs.
   ```
   ✗ PaymentVerificationFailed: Payment amount 0.005 USDC is less than required 0.01 USDC
     Route: GET /api/search
     Required: 0.01 USDC | Received: 0.005 USDC
     Fix: Ensure the client pays the full amount from the 402 pricing field.
     Docs: https://openagentpay.dev/errors/insufficient-payment
   ```

4. **Types are documentation.** Full TypeScript types with JSDoc on every field. IDE autocomplete should teach the API without reading docs.

5. **Sensible defaults, no required config.** `createPaywall({ recipient: '0x...' })` should work with zero other config. Mock adapter auto-selected in test env. Receipts auto-stored in memory.

6. **Progressive disclosure.** Simple things are one line. Advanced features are discoverable but not required. A developer should never feel overwhelmed.

### API Design Principles (Stripe Patterns Applied)

1. **Resource-oriented.** Subscriptions, receipts, payments are resources with consistent CRUD patterns.

2. **Idempotent by default.** Every payment operation supports idempotency keys. Retrying a payment with the same key returns the same result without double-charging.

3. **Consistent naming.** Everything is `snake_case` in JSON, `camelCase` in TypeScript. No exceptions.

4. **Expandable responses.** Receipts can include related objects inline or as references:
   ```typescript
   // Compact: just the ID
   { payment: { transaction_hash: "0x..." } }

   // Expanded: full details
   { payment: { transaction_hash: "0x...", block_number: 12345, ... } }
   ```

5. **Versioned from day 1.** The 402 response includes `version: "1.0"`. Clients declare which version they understand. Breaking changes get a new version, not a breaking update.

6. **Webhooks / Events.** Every state change emits an event. Events are typed. Events include the full object state, not just an ID.

### Error Handling Standards

| Error Code | HTTP Status | When | Agent Should |
|------------|-------------|------|-------------|
| `payment_required` | 402 | No payment attached | Parse pricing, pay, retry |
| `insufficient_amount` | 402 | Payment too low | Repay with correct amount |
| `payment_expired` | 402 | Payment signature too old | Generate fresh payment |
| `payment_replay` | 402 | Nonce already used | Generate new nonce |
| `payment_failed` | 402 | On-chain settlement failed | Retry or use different method |
| `subscription_expired` | 402 | Subscription token expired | Renew or switch to per-call |
| `subscription_exhausted` | 429 | Call limit reached | Wait for reset or upgrade plan |
| `rate_limited` | 429 | Too many calls/minute | Back off and retry |
| `policy_denied` | 403 | Agent policy rejected payment | Escalate to human or skip |
| `facilitator_unavailable` | 503 | Payment infra is down | Retry with backoff |

### Testing Standards

- **Unit test coverage: ≥90%** for all packages
- **100% coverage for policy engine** (safety-critical code)
- **Integration tests** for every payment flow (per-call, credits, subscription, x402)
- **Contract tests** for the 402 response schema (validate against JSON Schema)
- **End-to-end tests** that run the full flow: server → 402 → client pays → server verifies → receipt
- **Chaos tests** for failure modes: facilitator timeout, double payment, expired subscription, nonce replay
- **Example tests** that verify every code example in docs compiles and runs

### Documentation Standards

Every package must have:
- **README** with 1-line description, install command, 5-line quickstart
- **API reference** auto-generated from TypeScript types (TypeDoc)
- **Guides** organized by use case:
  - "Accept your first agent payment" (server)
  - "Pay for an API call" (client)
  - "Set up spend policies" (policy)
  - "Manage subscriptions" (subscription)
  - "Export receipts" (receipts)
  - "Integrate with MCP" (mcp)
- **Migration guides** for version upgrades
- **Changelog** per package (auto-generated by Changesets)

### Security Standards

- **Responsible disclosure policy** published in `SECURITY.md`
- **No secrets in code** — all keys via env vars, documented in `.env.example`
- **Nonce tracking** for replay protection on every payment
- **Payment amount validation** — server independently verifies amount matches pricing
- **Subscription token signing** — tokens are signed JWTs, not guessable IDs
- **Rate limiting** on subscription management endpoints (prevent abuse)
- **Input validation** on all public-facing schemas (zod or similar)
- **Dependency audit** in CI (npm audit, Snyk, or similar)
- **Security review before v1.0** — documented threat model, known limitations

---

*Last updated: 2026-03-15*
*Current phase: Phase 5 — In Progress*
*Overall status: 🟢 Phase 1-4 complete + Phase 5 partial (11 packages, 12,114 lines of TypeScript)*
