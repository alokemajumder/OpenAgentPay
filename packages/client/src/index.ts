/**
 * @openagentpay/client
 *
 * Agent-side HTTP client SDK for OpenAgentPay — the payment
 * infrastructure for AI agents.
 *
 * This package wraps any standard `fetch` function and transparently
 * handles HTTP 402 Payment Required responses. When an API requires
 * payment, the wrapper automatically:
 *
 * 1. Parses the structured 402 response
 * 2. Evaluates the agent's spend policy
 * 3. Executes payment via the configured wallet adapter
 * 4. Retries the request with the payment proof attached
 * 5. Tracks spend and emits structured receipts
 *
 * @example
 * ```typescript
 * import { withPayment } from '@openagentpay/client';
 *
 * const paidFetch = withPayment(fetch, {
 *   wallet: myWalletAdapter,
 *   policy: {
 *     maxPerRequest: '1.00',
 *     maxPerDay: '50.00',
 *     allowedDomains: ['*.example.com'],
 *   },
 *   onReceipt: (receipt) => {
 *     console.log(`Paid ${receipt.payment.amount} ${receipt.payment.currency}`);
 *   },
 * });
 *
 * // Use exactly like fetch — 402s are handled automatically
 * const response = await paidFetch('https://api.example.com/search?q=AI');
 * ```
 *
 * @packageDocumentation
 */

// Core API
export { withPayment } from "./client.js";

// Types
export type {
  ClientConfig,
  WalletAdapter,
  SpendPolicy,
  SubscriptionConfig,
  PaidFetch,
} from "./types.js";

// Spend tracking (exposed for advanced use cases and testing)
export { SpendTracker } from "./spend-tracker.js";
