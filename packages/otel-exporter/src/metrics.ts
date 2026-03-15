/**
 * Payment metrics — creates OpenTelemetry counters and histograms
 * for agent payment activity.
 *
 * @packageDocumentation
 */

import { metrics } from "@opentelemetry/api";
import type { AgentPaymentReceipt } from "@openagentpay/core";
import type { PaymentMetricsConfig, PaymentFailure } from "./types.js";

/**
 * Creates payment metrics instruments that record agent payment activity
 * as OpenTelemetry counters and histograms.
 *
 * The meter uses the global OTel MeterProvider — configure your SDK
 * before calling this.
 *
 * @example
 * ```ts
 * import { createPaymentMetrics } from '@openagentpay/otel-exporter'
 *
 * const paymentMetrics = createPaymentMetrics()
 *
 * // In your onReceipt callback:
 * paymentMetrics.recordPayment(receipt)
 * ```
 */
export function createPaymentMetrics(config?: PaymentMetricsConfig) {
  const meterName = config?.meterName ?? "openagentpay";
  const meter = metrics.getMeter(meterName);

  const paymentCount = meter.createCounter("openagentpay.payments.count", {
    description: "Total number of agent payments",
  });

  const paymentAmount = meter.createCounter("openagentpay.payments.amount", {
    description: "Total amount spent on agent payments",
  });

  const paymentLatency = meter.createHistogram(
    "openagentpay.payments.latency",
    {
      description: "Agent payment response latency distribution",
      unit: "ms",
    },
  );

  const paymentFailures = meter.createCounter(
    "openagentpay.payments.failures",
    {
      description: "Total number of failed agent payments",
    },
  );

  return {
    /**
     * Record a successful payment in metrics.
     */
    recordPayment(receipt: AgentPaymentReceipt): void {
      const labels = {
        method: receipt.payment.method,
        currency: receipt.payment.currency,
        status: receipt.payment.status,
      };

      paymentCount.add(1, labels);

      paymentAmount.add(Number.parseFloat(receipt.payment.amount), {
        method: receipt.payment.method,
        currency: receipt.payment.currency,
      });

      paymentLatency.record(receipt.response.latency_ms);
    },

    /**
     * Record a payment failure in metrics.
     */
    recordFailure(error: Pick<PaymentFailure, "code">): void {
      paymentFailures.add(1, { code: error.code });
    },
  };
}
