# Getting Paid — How API Owners Collect Payments

OpenAgentPay is **not a payment processor**. It's middleware that sits in your API and handles the 402 payment protocol. The actual money moves through payment adapters — each with a different settlement model.

This guide explains exactly how money gets from an AI agent's wallet to your bank account.

---

## How Each Payment Method Works

### x402 (USDC on Base) — Direct On-Chain Settlement

This is the primary production payment method. USDC moves directly from the agent's wallet to yours on the Base L2 network.

**The exact flow:**

```
1. Agent calls your API
2. Your middleware returns 402 with your wallet address (pay_to)
3. Agent signs an EIP-3009 transferWithAuthorization
   (off-chain signature authorizing USDC transfer)
4. Agent retries the request with the signed proof in X-PAYMENT header
5. Your middleware forwards the proof to the facilitator
6. Facilitator verifies the signature and submits the transaction on-chain
   (facilitator pays gas — gasless for both you and the agent)
7. USDC moves directly from agent wallet → your wallet on Base
8. Settlement: ~200 milliseconds
9. Your middleware serves the API response
```

**Key facts:**
- USDC goes **directly** to your wallet address. The facilitator never holds your funds — it only submits the pre-signed transaction.
- You need nothing more than a valid Ethereum address on the Base network to start receiving.
- The facilitator (default: Coinbase's hosted service at `x402.org/facilitator`) handles all blockchain interaction, gas fees, and signature verification.
- Current cost: Coinbase's facilitator charges ~$0.001/transaction after a free tier of 1,000 transactions/month.

### Credits — Prepaid Balance System

Credits are a ledger-based system where agents pre-purchase a balance and spend it per call.

**How it works:**

```
1. Agent purchases credits through your purchase endpoint
   (you implement this — Stripe checkout, crypto transfer, invoice, etc.)
2. Your server creates a credit account with the purchased balance
3. Per API call, agent sends X-CREDITS header with their account ID
4. Your middleware atomically deducts the cost from their credit balance
5. No blockchain transaction per call — instant, zero fees
```

**Who holds the money:** You do. Credits are a prepaid model — the agent paid you upfront when they purchased credits. Your `CreditStore` just tracks the remaining balance.

**You need to build:** The actual credit purchase flow (how agents buy credits). OpenAgentPay provides the `CreditStore` for balance tracking and the `CreditsAdapter` for per-call deduction, but the purchase mechanism is yours to implement. Common approaches:
- A Stripe Checkout page that creates a credit account on success
- A crypto payment address that tops up credits on transfer
- An invoice/billing system for enterprise agents

### Mock — No Real Money

The mock adapter is for development only. No money moves. Every payment auto-succeeds.

---

## Setting Up Your Wallet (x402)

### Option 1: Coinbase Account (Simplest Path to Fiat)

1. Create a [Coinbase](https://www.coinbase.com) account
2. Navigate to Receive → USDC → Base network
3. Copy your deposit address
4. Use this address as `recipient` in your paywall config:
   ```typescript
   const paywall = createPaywall({
     recipient: '0xYourCoinbaseDepositAddress',
     adapters: [x402({ network: 'base' })],
   });
   ```
5. USDC from agent payments appears directly in your Coinbase account
6. Sell USDC for USD and withdraw to your bank

**Advantages:** Automatic fiat conversion available. No wallet management. Regulatory compliance handled by Coinbase.

### Option 2: Self-Custodial Wallet

Use MetaMask, Rabby, or any EVM wallet:
1. Add the Base network to your wallet:
   - Network name: Base
   - RPC URL: `https://mainnet.base.org`
   - Chain ID: 8453
   - Currency: ETH
2. Add the USDC token: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
3. Use your wallet address as `recipient`

**Advantages:** Full custody and control. No account needed.

### Option 3: Multisig Wallet (Teams/Business)

Use [Safe](https://safe.global/) (formerly Gnosis Safe) on Base:
1. Create a Safe with your team members as signers
2. Set a threshold (e.g., 2 of 3 signers to withdraw)
3. Use the Safe address as `recipient`

**Advantages:** No single person controls the funds. Suitable for business use.

### Option 4: Hardware Wallet

Ledger or Trezor, connected to MetaMask or Rabby with Base network:
1. Connect hardware wallet to a web wallet interface
2. Add Base network
3. Use the hardware wallet address as `recipient`

**Advantages:** Most secure option for high-value accounts.

---

## Converting USDC to Fiat (Getting Money to Your Bank)

Once USDC is in your wallet, you have several paths to fiat:

### Exchange-Based (Most Common)

| Service | How | Fees | Speed |
|---------|-----|------|-------|
| **Coinbase** | Sell USDC → USD, withdraw via ACH | 0% USDC-to-USD, free ACH | 1-3 business days |
| **Coinbase (wire)** | Sell USDC → USD, wire transfer | 0% USDC-to-USD, $25 wire fee | Same day |
| **Kraken** | Deposit USDC, sell, withdraw | ~0.1% trade fee | 1-5 business days |
| **Gemini** | Deposit USDC, sell, withdraw | ~0.2% trade fee | 3-5 business days |

### Direct Redemption (Enterprise)

| Service | How | Fees | Speed |
|---------|-----|------|-------|
| **Circle Mint** | Redeem USDC 1:1 for USD with Circle (the USDC issuer) | 0% | 1 business day |
| **Stripe** | Accept USDC via Stripe, auto-converts to fiat in your Stripe balance | Standard Stripe fees | Standard Stripe payout schedule |

### Automated / API-Driven

For high-volume API providers who want hands-off fiat conversion:

- **Coinbase Commerce** — set up a merchant account, receive USDC, opt-in to automatic fiat conversion and daily bank payouts
- **Circle APIs** — programmatic USDC-to-fiat conversion for enterprise treasury management
- **Stripe USDC acceptance** — Stripe now supports USDC on Base natively; funds auto-settle to your Stripe-connected bank account

---

## Transaction Costs

### x402 Payment Costs

| Component | Cost | Who Pays |
|-----------|------|----------|
| Base L2 gas fee | ~$0.001 per transaction | Facilitator (included in their fee) |
| Facilitator fee | ~$0.001 per transaction (first 1,000/month free on Coinbase) | Deducted from payment or billed separately |
| USDC-to-fiat conversion | 0-0.5% depending on service | API owner |
| **Total cost to receive $0.01** | **~$0.001-$0.002** | |

Compare with traditional payment rails:
- Credit card: $0.30 + 2.9% minimum per charge (impossible for $0.01 payments)
- PayPal: $0.30 + 2.9% minimum
- ACH: $0.25-$1.00 minimum

**x402 micropayments are 100-300x cheaper than traditional rails for sub-$1 transactions.**

### Credits Payment Costs

| Component | Cost | Who Pays |
|-----------|------|----------|
| Per-call processing | $0 (ledger deduction only) | Nobody |
| Credit purchase (if via Stripe) | 2.9% + $0.30 per purchase | Agent (one-time) |
| Credit purchase (if via crypto) | ~$0.001 per transfer | Agent (one-time) |

Credits have zero per-call cost. The only cost is the initial credit purchase transaction.

---

## Accounting and Tax

### USDC is Income

The IRS and most tax authorities treat USDC receipt as income at fair market value at the time of receipt. Since USDC is pegged 1:1 to USD, the accounting is straightforward:

- Each payment = income at the USDC amount (e.g., 0.01 USDC = $0.01 income)
- No capital gains/losses on USDC itself (it's always ~$1.00)
- Aggregate micropayments for reporting (you don't need to file each $0.01 separately)

### Record Keeping

OpenAgentPay's receipt system (`@openagentpay/receipts`) provides the data you need:

```typescript
import { createReceiptStore } from '@openagentpay/receipts';

const store = createReceiptStore({ type: 'file', path: './payment-records' });

// At tax time: export all receipts
const csv = await store.export({ format: 'csv' });
// → id, timestamp, payer, payee, endpoint, amount, currency, method, status, transaction_hash, latency_ms, task_id
```

### Recommended Tax Tools

For high-volume micropayment tracking:
- **TaxBit** — automated crypto tax reporting
- **CoinTracker** — portfolio tracking + tax reports
- **Bitwave** — enterprise crypto accounting

---

## What OpenAgentPay Handles vs. What You Handle

| Concern | OpenAgentPay | API Owner |
|---------|-------------|-----------|
| 402 response with pricing | Handled | — |
| Payment verification | Handled (via facilitator) | — |
| Replay protection (nonce tracking) | Handled | — |
| Receipt generation | Handled | — |
| Receipt storage + export | Handled (`@openagentpay/receipts`) | — |
| Wallet setup | — | You set up a wallet and provide the address |
| USDC-to-fiat conversion | — | You choose an offramp (Coinbase, Circle, Stripe) |
| Credit purchase flow | — | You implement the purchase endpoint |
| Tax reporting | — | You use receipts for accounting |
| Terms of Service | — | You define your terms |

---

## Regulatory FAQ

### Am I a money transmitter?

**Probably not**, if you use Coinbase's hosted facilitator. You are receiving payment for a service you provide — like any merchant accepting payment. You never take custody of agent funds or transfer money on behalf of others.

However, if you:
- Build your own facilitator that handles fund transfers
- Hold agent funds in escrow
- Offer credit refunds or transfers between accounts

...you may need to consult a lawyer about money transmission regulations in your jurisdiction.

### Do I need KYC for my API customers (agents)?

With x402 direct payments: **No.** The agent pays from their own wallet. You're a merchant, not a financial institution. The KYC obligation (if any) is on the agent operator, not on you.

With credits: **Depends.** If your credit system holds significant stored value and offers refunds, stored-value regulations may apply in some jurisdictions.

### What about OFAC sanctions?

Coinbase's hosted facilitator includes built-in sanctions screening (OFAC/SDN list checks). If you use the default facilitator, this is handled for you.

---

## Recommended Setup by Scale

### Hobby / Side Project
- Wallet: Coinbase account
- Offramp: Sell on Coinbase, withdraw to bank
- Accounting: Export receipts as CSV, manual tracking

### Small Business / Indie API
- Wallet: Coinbase Business account or self-custodial
- Offramp: Coinbase auto-conversion or Stripe USDC acceptance
- Accounting: CoinTracker or TaxBit

### Enterprise
- Wallet: Safe multisig on Base
- Offramp: Circle Mint (direct 1:1 USD redemption) or Stripe
- Accounting: Bitwave or enterprise crypto accounting
- Compliance: Legal review of your specific jurisdiction
- Storage: File-based receipt store with backup, or integrate with your data warehouse
