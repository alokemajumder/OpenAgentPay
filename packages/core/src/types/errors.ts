/**
 * @module errors
 *
 * Typed error classes following Stripe's error pattern.
 *
 * Every error has:
 * - `type`       — error category for programmatic handling
 * - `code`       — machine-readable error code
 * - `message`    — human-readable description
 * - `statusCode` — suggested HTTP status code
 * - `docUrl`     — optional link to documentation
 */

// ---------------------------------------------------------------------------
// Base Error
// ---------------------------------------------------------------------------

/**
 * Base class for all OpenAgentPay errors.
 *
 * Follows Stripe's error pattern: every error is typed, coded,
 * and includes a suggested HTTP status code. This enables both
 * programmatic error handling and clear developer diagnostics.
 */
export class OpenAgentPayError extends Error {
  /** Error category for programmatic switch/case handling. */
  readonly type: string;

  /** Machine-readable error code (e.g. `"payment_required"`). */
  readonly code: string;

  /** Suggested HTTP status code for this error. */
  readonly statusCode: number;

  /** Optional link to relevant documentation. */
  readonly docUrl?: string;

  constructor(params: {
    type: string;
    code: string;
    message: string;
    statusCode: number;
    docUrl?: string;
  }) {
    super(params.message);
    this.name = "OpenAgentPayError";
    this.type = params.type;
    this.code = params.code;
    this.statusCode = params.statusCode;
    this.docUrl = params.docUrl;

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Serialize to a JSON-friendly object for API responses.
   */
  toJSON(): {
    type: string;
    code: string;
    message: string;
    status_code: number;
    doc_url?: string;
  } {
    return {
      type: this.type,
      code: this.code,
      message: this.message,
      status_code: this.statusCode,
      ...(this.docUrl ? { doc_url: this.docUrl } : {}),
    };
  }
}

// ---------------------------------------------------------------------------
// Payment Errors
// ---------------------------------------------------------------------------

/**
 * The requested resource requires payment.
 *
 * Thrown when a request is made without a payment proof
 * to a paywalled endpoint.
 */
export class PaymentRequiredError extends OpenAgentPayError {
  constructor(message = "This resource requires payment.") {
    super({
      type: "payment_error",
      code: "payment_required",
      message,
      statusCode: 402,
      docUrl: "https://docs.openagentpay.com/errors/payment-required",
    });
    this.name = "PaymentRequiredError";
  }
}

/**
 * The payment amount is less than the required price.
 *
 * Thrown during verification when the payment proof contains
 * an amount that does not meet the endpoint's pricing.
 */
export class InsufficientAmountError extends OpenAgentPayError {
  constructor(
    message = "Payment amount is less than the required price.",
  ) {
    super({
      type: "payment_error",
      code: "insufficient_amount",
      message,
      statusCode: 402,
      docUrl: "https://docs.openagentpay.com/errors/insufficient-amount",
    });
    this.name = "InsufficientAmountError";
  }
}

/**
 * The payment proof has already been used (replay attack).
 *
 * Thrown during verification when the nonce in the payment
 * proof has been seen before.
 */
export class PaymentReplayError extends OpenAgentPayError {
  constructor(message = "Payment proof has already been used.") {
    super({
      type: "payment_error",
      code: "payment_replay",
      message,
      statusCode: 402,
      docUrl: "https://docs.openagentpay.com/errors/payment-replay",
    });
    this.name = "PaymentReplayError";
  }
}

/**
 * The payment authorization has expired.
 *
 * Thrown when the payment proof's timeout has elapsed before
 * verification could complete.
 */
export class PaymentExpiredError extends OpenAgentPayError {
  constructor(message = "Payment authorization has expired.") {
    super({
      type: "payment_error",
      code: "payment_expired",
      message,
      statusCode: 402,
      docUrl: "https://docs.openagentpay.com/errors/payment-expired",
    });
    this.name = "PaymentExpiredError";
  }
}

// ---------------------------------------------------------------------------
// Policy Errors
// ---------------------------------------------------------------------------

/**
 * The payment was denied by the agent's policy engine.
 *
 * Thrown client-side when a payment request violates the
 * configured spend governance rules.
 */
export class PolicyDeniedError extends OpenAgentPayError {
  /** The policy rule that caused the denial. */
  readonly rule?: string;

  constructor(message = "Payment denied by policy.", rule?: string) {
    super({
      type: "policy_error",
      code: "policy_denied",
      message,
      statusCode: 403,
      docUrl: "https://docs.openagentpay.com/errors/policy-denied",
    });
    this.name = "PolicyDeniedError";
    this.rule = rule;
  }
}

// ---------------------------------------------------------------------------
// Subscription Errors
// ---------------------------------------------------------------------------

/**
 * The subscription token has expired.
 *
 * Thrown when an agent presents a subscription token that
 * has passed its expiry date.
 */
export class SubscriptionExpiredError extends OpenAgentPayError {
  constructor(message = "Subscription has expired.") {
    super({
      type: "subscription_error",
      code: "subscription_expired",
      message,
      statusCode: 402,
      docUrl: "https://docs.openagentpay.com/errors/subscription-expired",
    });
    this.name = "SubscriptionExpiredError";
  }
}

/**
 * The subscription's call limit has been reached.
 *
 * Thrown when the agent has used all allocated calls
 * in the current billing period.
 */
export class SubscriptionExhaustedError extends OpenAgentPayError {
  constructor(message = "Subscription call limit reached.") {
    super({
      type: "subscription_error",
      code: "subscription_exhausted",
      message,
      statusCode: 402,
      docUrl:
        "https://docs.openagentpay.com/errors/subscription-exhausted",
    });
    this.name = "SubscriptionExhaustedError";
  }
}

// ---------------------------------------------------------------------------
// Infrastructure Errors
// ---------------------------------------------------------------------------

/**
 * The x402 facilitator service is unavailable.
 *
 * Thrown when the payment facilitator cannot be reached
 * for verification or settlement.
 */
export class FacilitatorUnavailableError extends OpenAgentPayError {
  constructor(
    message = "Payment facilitator is temporarily unavailable.",
  ) {
    super({
      type: "infrastructure_error",
      code: "facilitator_unavailable",
      message,
      statusCode: 503,
      docUrl:
        "https://docs.openagentpay.com/errors/facilitator-unavailable",
    });
    this.name = "FacilitatorUnavailableError";
  }
}

// ---------------------------------------------------------------------------
// Validation Errors
// ---------------------------------------------------------------------------

/**
 * Input validation failed when parsing a PaymentRequired body
 * or other structured data.
 */
export class ValidationError extends OpenAgentPayError {
  /** The specific field that failed validation. */
  readonly field?: string;

  constructor(message: string, field?: string) {
    super({
      type: "validation_error",
      code: "invalid_input",
      message,
      statusCode: 400,
      docUrl: "https://docs.openagentpay.com/errors/validation",
    });
    this.name = "ValidationError";
    this.field = field;
  }
}
