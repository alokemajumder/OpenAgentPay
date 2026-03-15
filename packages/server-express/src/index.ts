/**
 * @openagentpay/server-express
 *
 * Express.js paywall middleware for OpenAgentPay.
 * Accept AI agent payments with one line of middleware per route.
 *
 * @example
 * ```ts
 * import { createPaywall } from '@openagentpay/server-express'
 * import { mock } from '@openagentpay/adapter-mock'
 *
 * const paywall = createPaywall({
 *   recipient: '0x1234...',
 *   adapters: [mock()],
 * })
 *
 * app.get('/api/search', paywall({ price: '0.01' }), searchHandler)
 *
 * paywall.on('payment:received', (receipt) => {
 *   console.log(`Earned ${receipt.payment.amount} ${receipt.payment.currency}`)
 * })
 * ```
 */

export { createPaywall } from './paywall.js';
export type { Paywall } from './paywall.js';

export type {
  PaywallConfig,
  PaywallRouteConfig,
  PaywallRouteFn,
  PaywallRouteArg,
  PaywallEvents,
  ReceiptStore,
  SubscriptionStore,
  Subscription,
  ReceiptsConfig,
  SubscriptionsConfig,
} from './types.js';

export { TypedEventEmitter } from './event-emitter.js';
