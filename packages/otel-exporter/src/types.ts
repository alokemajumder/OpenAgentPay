/**
 * Configuration types for the OpenAgentPay OpenTelemetry integration.
 *
 * @packageDocumentation
 */

/**
 * Configuration for {@link createPaymentTracer}.
 */
export interface PaymentTracerConfig {
  /** OTel tracer name. Default: `'openagentpay'` */
  tracerName?: string;

  /** OTel tracer version. Default: package version */
  tracerVersion?: string;

  /** Whether to include request/response hashes in span attributes. Default: `true` */
  includeHashes?: boolean;
}

/**
 * Configuration for {@link createPaymentMetrics}.
 */
export interface PaymentMetricsConfig {
  /** OTel meter name. Default: `'openagentpay'` */
  meterName?: string;
}

/**
 * Error details for recording payment failures.
 */
export interface PaymentFailure {
  /** Machine-readable error code. */
  code: string;

  /** Human-readable error message. */
  message: string;

  /** The URL that was being called when the failure occurred. */
  url?: string;
}
