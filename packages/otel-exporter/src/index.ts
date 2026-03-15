/**
 * @openagentpay/otel-exporter
 *
 * OpenTelemetry integration for OpenAgentPay — export agent payment
 * events as OTel spans and metrics for visibility in Datadog, Grafana,
 * Jaeger, and any other OTel-compatible backend.
 *
 * @example
 * ```ts
 * import { createPaymentTracer, createPaymentMetrics } from '@openagentpay/otel-exporter'
 * import { withPayment, mockWallet } from '@openagentpay/core'
 *
 * const tracer = createPaymentTracer()
 * const paymentMetrics = createPaymentMetrics()
 *
 * const paidFetch = withPayment(fetch, {
 *   wallet: mockWallet(),
 *   onReceipt: (receipt) => {
 *     tracer.recordPayment(receipt)
 *     paymentMetrics.recordPayment(receipt)
 *   },
 * })
 * ```
 *
 * @packageDocumentation
 */

export { createPaymentTracer } from "./tracer.js";
export { createPaymentMetrics } from "./metrics.js";
export type {
  PaymentTracerConfig,
  PaymentMetricsConfig,
  PaymentFailure,
} from "./types.js";
