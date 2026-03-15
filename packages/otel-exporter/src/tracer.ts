/**
 * Payment tracer — creates OpenTelemetry spans from AgentPaymentReceipt data.
 *
 * @packageDocumentation
 */

import { trace, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import type { AgentPaymentReceipt } from "@openagentpay/core";
import type { PaymentTracerConfig, PaymentFailure } from "./types.js";

const PKG_VERSION = "0.1.0";

/**
 * Creates a payment tracer that records agent payments as OpenTelemetry spans.
 *
 * The tracer uses the global OTel TracerProvider — configure your SDK
 * (Jaeger, Datadog, Grafana, etc.) before calling this.
 *
 * @example
 * ```ts
 * import { createPaymentTracer } from '@openagentpay/otel-exporter'
 *
 * const tracer = createPaymentTracer()
 *
 * // In your onReceipt callback:
 * tracer.recordPayment(receipt)
 * ```
 */
export function createPaymentTracer(config?: PaymentTracerConfig) {
  const tracerName = config?.tracerName ?? "openagentpay";
  const tracerVersion = config?.tracerVersion ?? PKG_VERSION;
  const includeHashes = config?.includeHashes ?? true;

  const tracer = trace.getTracer(tracerName, tracerVersion);

  return {
    /**
     * Record a successful payment as an OTel span.
     * Call this from the `onReceipt` callback.
     */
    recordPayment(receipt: AgentPaymentReceipt): void {
      const span = tracer.startSpan("openagentpay.payment", {
        kind: SpanKind.CLIENT,
        startTime: new Date(receipt.timestamp),
        attributes: {
          // Receipt
          "openagentpay.receipt.id": receipt.id,

          // Payment
          "openagentpay.payment.amount": receipt.payment.amount,
          "openagentpay.payment.currency": receipt.payment.currency,
          "openagentpay.payment.method": receipt.payment.method,
          "openagentpay.payment.status": receipt.payment.status,

          // Payer
          "openagentpay.payer.identifier": receipt.payer.identifier,
          "openagentpay.payer.type": receipt.payer.type,

          // Payee
          "openagentpay.payee.endpoint": receipt.payee.endpoint,
          "openagentpay.payee.identifier": receipt.payee.identifier,

          // Request
          "openagentpay.request.method": receipt.request.method,
          "openagentpay.request.url": receipt.request.url,

          // Response
          "openagentpay.response.status_code": receipt.response.status_code,
          "openagentpay.response.latency_ms": receipt.response.latency_ms,
        },
      });

      // Optional attributes
      if (receipt.payment.transaction_hash) {
        span.setAttribute(
          "openagentpay.payment.transaction_hash",
          receipt.payment.transaction_hash,
        );
      }

      if (receipt.policy) {
        span.setAttribute(
          "openagentpay.policy.decision",
          receipt.policy.decision,
        );
      }

      if (includeHashes) {
        if (receipt.request.body_hash) {
          span.setAttribute(
            "openagentpay.request.body_hash",
            receipt.request.body_hash,
          );
        }
        if (receipt.response.content_hash) {
          span.setAttribute(
            "openagentpay.response.content_hash",
            receipt.response.content_hash,
          );
        }
      }

      // Mark failed payments with error status
      if (receipt.payment.status === "failed") {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Payment failed",
        });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }

      // End the span at request time + latency
      const endTime = new Date(
        new Date(receipt.timestamp).getTime() + receipt.response.latency_ms,
      );
      span.end(endTime);
    },

    /**
     * Record a payment failure as an error span.
     */
    recordFailure(error: PaymentFailure): void {
      const span = tracer.startSpan("openagentpay.payment", {
        kind: SpanKind.CLIENT,
        attributes: {
          "openagentpay.error.code": error.code,
          "openagentpay.error.message": error.message,
          ...(error.url
            ? { "openagentpay.request.url": error.url }
            : undefined),
        },
      });

      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });

      span.end();
    },
  };
}
