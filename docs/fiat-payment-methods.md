# Fiat Payment Methods — Stripe, PayPal, and UPI

OpenAgentPay's adapter pattern supports any payment rail. While x402 (USDC) is the native protocol for direct agent-to-API payments, many API owners and agent operators prefer traditional fiat rails. This guide covers how Stripe, PayPal, and UPI (India) can work with OpenAgentPay.

---

## The Core Challenge: Micropayments on Fiat Rails

AI agents make many small API calls — often $0.001 to $0.10 each. Traditional payment processors charge a fixed fee per transaction:

| Processor | Per-Transaction Fee | Cost to Process $0.01 |
|-----------|--------------------|-----------------------|
| Stripe | $0.30 + 2.9% | $0.30 (3,000% of payment) |
| PayPal | $0.49 + 3.49% | $0.49 (4,900% of payment) |
| PayPal Micropayments | $0.09 + 4.99% | $0.09 (900% of payment) |
| UPI (India) | ~0% under Rs 2,000 | ~$0.00 |
| x402 (USDC on Base) | ~$0.001 | ~$0.001 (10% of payment) |

**Direct per-call charging is economically impossible on Stripe and PayPal.** The solution: aggregate micro-usage into periodic charges, or use prepaid credits.

---

## Stripe

### How It Works with OpenAgentPay

Stripe cannot charge per API call (minimum $0.50 USD, and fees destroy margins). Instead, there are two viable models:

#### Model 1: Metered Billing (Recommended)

Each API call is reported as a usage event. Stripe aggregates and invoices periodically.

**Setup (one-time, requires human):**
1. Agent operator creates a Stripe Customer with a saved payment method via Setup Intent or Checkout Session
2. API owner creates a Stripe Subscription with a metered price (e.g., $0.01 per unit)

**Runtime (fully autonomous):**
1. Each API call → API owner reports a meter event to Stripe
2. End of billing period → Stripe generates invoice → charges saved card
3. No human interaction needed after setup

**Economics:**
- 1,000 API calls at $0.01 each = $10.00 monthly invoice
- Stripe fee: $0.59 (5.9%) — one charge instead of 1,000
- Effective per-call fee: $0.00059

**Stripe API calls involved:**
- Setup: `POST /v1/customers`, `POST /v1/setup_intents`, `POST /v1/subscriptions`
- Per call: `POST /v1/billing/meter_events` (async, lightweight)
- Stripe handles invoicing, collection, and retries automatically

#### Model 2: Prepaid Credits via Customer Balance

Agent operator pre-loads credits. API calls deduct from the balance. Zero payment processing per call.

**Setup (one-time):**
1. Agent operator pays $50 via Stripe Checkout or Payment Intent
2. API owner adds $50 credit to the Stripe Customer Balance:
   `POST /v1/customers/{id}/balance_transactions` with amount `-5000` (negative = credit)

**Runtime:**
1. Each API call → API owner deducts from Customer Balance via balance transaction
2. When balance drops below threshold → auto-charge saved card to top up
3. No per-call payment processing fees

**Key facts about Stripe Customer Balance:**
- Balance transactions are immutable (append-only ledger)
- Credits auto-apply to the next finalized invoice
- No Stripe fees on balance deductions — fees only on the initial charge and top-ups

#### Model 3: Off-Session Charges (for larger amounts only)

For infrequent, higher-value API calls (minimum $0.50):
- Saved payment method charged via `POST /v1/payment_intents` with `off_session: true` and `confirm: true`
- No UI needed after initial card setup
- Customer must have explicitly consented to future off-session charges during setup

### Stripe Minimum Charges by Currency

| Currency | Minimum Charge |
|----------|---------------|
| USD | $0.50 |
| EUR | €0.50 |
| GBP | £0.30 |
| INR | ₹0.50 |
| JPY | ¥50 |
| CAD | CA$0.50 |
| AUD | A$0.50 |

### Stripe Agent Toolkit

Stripe has built an official Agent Toolkit (Python and TypeScript) that integrates with OpenAI Agent SDK, LangChain, CrewAI, and Vercel AI SDK. It also has an MCP Server at `https://mcp.stripe.com`. This allows AI agents to create payment links, manage subscriptions, and process charges through Stripe APIs directly.

This is complementary to OpenAgentPay — Stripe handles the payment processing, OpenAgentPay handles the 402 discovery protocol, policy engine, and multi-provider abstraction.

---

## PayPal

### How It Works with OpenAgentPay

#### Billing Agreements (Pre-Authorized Charging)

**Setup (one-time, requires human):**
1. Agent operator approves a billing agreement via PayPal UI (one-time authorization)
2. PayPal returns a vault token / billing agreement ID
3. Token is stored by the API owner

**Runtime (fully autonomous):**
1. Usage is aggregated over a period (hourly, daily, or weekly)
2. API owner charges the aggregated amount against the billing agreement via REST API
3. No customer interaction needed

**PayPal API calls:**
- Setup: Vault API v3 to save payment method, or create billing agreement
- Per charge: Orders API with vaulted payment token

#### PayPal Micropayments Rate

PayPal offers a special micropayment pricing tier:
- **Standard:** 3.49% + $0.49 per transaction
- **Micropayments:** 4.99% + $0.09 per transaction (must be enabled on your account)

At the micropayment rate, charging $1.00 costs $0.14 (14%) instead of $0.53 (53%).

#### PayPal Subscriptions API

PayPal supports fixed, variable, and usage-based subscription plans:
- Create Product → Create Plan → Customer subscribes (one-time approval)
- Supports variable amounts per billing cycle
- Auto-payment recovery for failed charges

### Best PayPal Strategy for OpenAgentPay

1. Vault the payment method via billing agreement (one-time)
2. Aggregate usage internally (daily or weekly)
3. Charge aggregated amount against the vaulted token
4. Keep charges above $1.00 for reasonable fee ratios

---

## UPI (India)

### Why UPI Is Significant

UPI (Unified Payments Interface) has 300M+ active users in India. For India-based APIs and agents, UPI offers near-zero fees and a mandate system perfectly suited to recurring API billing.

### How UPI AutoPay / e-Mandate Works

**Setup (one-time, requires human):**
1. Agent operator creates a UPI AutoPay mandate via their UPI app
2. They authorize it by entering their UPI PIN (one-time approval)
3. Mandate specifies: maximum amount per debit, frequency, start/end dates
4. Mandate ID is stored by the API owner's payment gateway

**Runtime (fully autonomous):**
1. API owner aggregates usage over the mandate frequency period
2. Triggers a debit against the mandate via payment gateway API
3. Amount debited can vary per cycle (up to the mandate maximum)
4. Customer receives a notification before each debit (NPCI requirement)
5. For amounts under Rs 5,000: auto-executes, no additional authentication

### Mandate Limits

| Parameter | Limit |
|-----------|-------|
| Maximum per debit | Rs 15,000 (~$180) standard, up to Rs 1,00,000 for specific categories |
| Minimum per debit | Rs 1 (~$0.012) |
| Auto-execute threshold | Rs 5,000 — no additional auth needed below this |
| Above Rs 5,000 | May require additional customer approval (varies by bank) |

### Mandate Types

- **Fixed amount:** Same amount each cycle (like a subscription)
- **Variable amount (capped):** Amount varies each cycle up to the mandate maximum — **ideal for usage-based API billing**

Set a variable mandate with a high cap (e.g., Rs 10,000/month) and debit actual usage each period.

### NPCI Mandate Categories

UPI mandates are categorized by NPCI. For API billing, the relevant category is:
- **Subscription services** — covers SaaS, digital services, API access

### Payment Gateway Support

| Provider | UPI AutoPay API | Documentation |
|----------|----------------|---------------|
| Razorpay | Subscriptions API with UPI | Well-documented |
| Cashfree | Recurring Payments API | Good |
| Setu | UPI DeepLinks | Developer-friendly |
| PayTM for Business | UPI Mandate API | Moderate |
| Juspay | UPI Mandate API | Good |
| BillDesk | UPI Mandate API | Enterprise-focused |

### UPI Fee Structure

UPI is the cheapest payment rail available:
- **Transactions under Rs 2,000 (~$24):** 0% (government subsidized MDR waiver)
- **Transactions Rs 2,000+:** Payment gateway charges ~1-2%
- **No fixed per-transaction fee** in most cases

| Transaction | Gateway Fee (~2%) | Effective Cost |
|-------------|------------------|----------------|
| Rs 1 ($0.012) | Rs 0.02 | 2% |
| Rs 10 ($0.12) | Rs 0.20 | 2% |
| Rs 100 ($1.20) | Rs 0 (below Rs 2,000) | 0% |
| Rs 1,000 ($12) | Rs 0 (below Rs 2,000) | 0% |
| Rs 5,000 ($60) | Rs 100 | 2% |

### Best UPI Strategy for OpenAgentPay

1. Set up a variable-amount UPI mandate via Razorpay or Cashfree (one-time, agent operator enters UPI PIN)
2. Aggregate API usage daily or weekly
3. Execute debit against mandate for aggregated amount
4. Keep individual debits under Rs 5,000 to avoid additional authentication
5. Near-zero cost for most API billing scenarios

---

## Fee Comparison: All Methods

For 1,000 API calls at $0.01 each ($10.00 total):

| Method | Approach | Total Fees | Fee % |
|--------|----------|-----------|-------|
| **x402 (USDC)** | 1,000 individual on-chain payments | ~$1.00 | 10% |
| **x402 (USDC) batched** | Aggregate + single settlement | ~$0.001 | 0.01% |
| **Stripe metered** | 1 monthly invoice for $10.00 | $0.59 | 5.9% |
| **Stripe credits** | Pre-pay $50, deduct per call | $0 per-call ($1.75 on initial $50) | 3.5% amortized |
| **PayPal micro** | Daily aggregated charges ($0.33/day × 30) | $2.70 | 27% |
| **PayPal standard** | Weekly charges ($2.50 × 4) | $2.32 | 23.2% |
| **UPI** | Weekly mandate debits (~Rs 830 × 4) | $0.00 (under Rs 2,000 each) | 0% |

**Winners by market:**
- **India:** UPI — effectively free
- **US/EU:** Stripe metered billing — 5.9% on aggregated total
- **Global:** Stripe credits (prepaid) — amortize fees over large top-ups
- **Crypto-native:** x402 — lowest per-transaction cost, no aggregation needed

---

## Recommended Architecture for OpenAgentPay

### The Universal Pattern

Regardless of payment processor, the pattern is the same:

```
SETUP (one-time, human required):
  Agent operator → authorizes future charges
  (Stripe: saves card | PayPal: billing agreement | UPI: mandate)

RUNTIME (fully autonomous):
  Agent calls API → OpenAgentPay middleware handles 402 flow
  Usage tracked internally → aggregated per period
  Periodic charge against saved authorization → single transaction
  OR: deduct from prepaid credit balance → zero per-call fees
```

### Adapter Architecture

Each fiat payment method becomes an OpenAgentPay adapter:

```
PaymentAdapter
 ├── adapter-x402        (direct, per-call, USDC)
 ├── adapter-credits     (prepaid balance, any funding source)
 ├── adapter-stripe      (metered billing or Customer Balance)
 ├── adapter-paypal      (billing agreement + aggregated charges)
 └── adapter-upi         (mandate + aggregated debits via Razorpay/Cashfree)
```

The credits adapter is the most universal bridge — agents can purchase credits via any payment method (Stripe, PayPal, UPI, crypto), and per-call deductions are instant and free.

### Setup Flow

The key difference from x402: **fiat adapters require a one-time human setup** to save a payment method. After that, everything is autonomous.

```
x402:    Agent has wallet → pays directly → no setup needed
Stripe:  Human saves card once → agent charges via metered billing → autonomous
PayPal:  Human approves agreement once → agent charges via vault → autonomous
UPI:     Human enters UPI PIN once → agent debits via mandate → autonomous
Credits: Human pre-pays once → agent deducts from balance → autonomous
```

The 402 response should advertise which setup is required:

```json
{
  "methods": [
    { "type": "x402", "network": "base", "pay_to": "0x..." },
    { "type": "credits", "purchase_url": "/credits/buy", "balance_url": "/credits/balance" },
    { "type": "stripe", "setup_url": "/billing/setup" },
    { "type": "upi", "mandate_url": "/billing/upi-mandate" }
  ]
}
```

---

## Regulatory Notes

### Stripe
- Stripe handles PCI compliance, SCA/3DS, and payment regulations
- API owner is a standard Stripe merchant — no special licensing needed
- Stripe is available in 46+ countries

### PayPal
- PayPal handles regulatory compliance in 200+ markets
- Billing agreements require clear disclosure of payment terms
- Cross-border fees apply (additional ~1.5%)

### UPI
- Regulated by NPCI (National Payments Corporation of India) and RBI (Reserve Bank of India)
- Mandate creation requires explicit customer consent via UPI PIN
- Pre-debit notifications are mandatory (NPCI rule)
- Available only in India, INR only
- No KYC burden on the API owner (KYC is handled by the customer's bank)
