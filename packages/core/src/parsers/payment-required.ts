/**
 * @module parsers/payment-required
 *
 * Parser and validator for incoming 402 Payment Required response bodies.
 *
 * Accepts `unknown` input (e.g. from `response.json()`) and validates
 * the structure, returning a strongly-typed `PaymentRequired` object
 * or throwing a `ValidationError` with a descriptive message.
 */

import type {
  PaymentRequired,
  PaymentMethod,
  SubscriptionPlan,
} from "../types/payment-required.js";
import { ValidationError } from "../types/errors.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function assertString(
  value: unknown,
  field: string,
): asserts value is string {
  if (typeof value !== "string") {
    throw new ValidationError(
      `Expected "${field}" to be a string, got ${typeof value}.`,
      field,
    );
  }
}

function assertObject(
  value: unknown,
  field: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError(
      `Expected "${field}" to be an object, got ${Array.isArray(value) ? "array" : typeof value}.`,
      field,
    );
  }
}

function assertArray(
  value: unknown,
  field: string,
): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(
      `Expected "${field}" to be an array, got ${typeof value}.`,
      field,
    );
  }
}

const VALID_UNITS = new Set([
  "per_request",
  "per_kb",
  "per_second",
  "per_unit",
]);
const VALID_PERIODS = new Set(["hour", "day", "week", "month"]);
const VALID_METHOD_TYPES = new Set(["x402", "credits", "stripe", "paypal", "upi", "mpp", "visa", "mock"]);

// ---------------------------------------------------------------------------
// Method validators
// ---------------------------------------------------------------------------

function validateX402Method(
  obj: Record<string, unknown>,
  index: number,
): void {
  const prefix = `methods[${index}]`;
  assertString(obj.network, `${prefix}.network`);
  assertString(obj.asset, `${prefix}.asset`);
  assertString(obj.asset_address, `${prefix}.asset_address`);
  assertString(obj.pay_to, `${prefix}.pay_to`);
  assertString(obj.facilitator_url, `${prefix}.facilitator_url`);

  if (
    obj.max_timeout_seconds !== undefined &&
    typeof obj.max_timeout_seconds !== "number"
  ) {
    throw new ValidationError(
      `Expected "${prefix}.max_timeout_seconds" to be a number.`,
      `${prefix}.max_timeout_seconds`,
    );
  }
}

function validateCreditsMethod(
  obj: Record<string, unknown>,
  index: number,
): void {
  const prefix = `methods[${index}]`;
  assertString(obj.purchase_url, `${prefix}.purchase_url`);
  assertString(obj.balance_url, `${prefix}.balance_url`);
}

function validateMethod(value: unknown, index: number): PaymentMethod {
  const prefix = `methods[${index}]`;
  assertObject(value, prefix);

  const obj = value as Record<string, unknown>;
  assertString(obj.type, `${prefix}.type`);

  // Strict validation for known types
  if (obj.type === "x402") {
    validateX402Method(obj, index);
  } else if (obj.type === "credits") {
    validateCreditsMethod(obj, index);
  }
  // Other types (stripe, paypal, upi, mpp, visa, mock, etc.) pass through
  // with just the type field validated — lenient validation for extensibility

  return value as unknown as PaymentMethod;
}

// ---------------------------------------------------------------------------
// Subscription validator
// ---------------------------------------------------------------------------

function validateSubscription(
  value: unknown,
  index: number,
): SubscriptionPlan {
  const prefix = `subscriptions[${index}]`;
  assertObject(value, prefix);

  const obj = value as Record<string, unknown>;
  assertString(obj.id, `${prefix}.id`);
  assertString(obj.amount, `${prefix}.amount`);
  assertString(obj.currency, `${prefix}.currency`);
  assertString(obj.period, `${prefix}.period`);

  if (!VALID_PERIODS.has(obj.period as string)) {
    throw new ValidationError(
      `Invalid subscription period "${obj.period as string}". Expected one of: ${[...VALID_PERIODS].join(", ")}.`,
      `${prefix}.period`,
    );
  }

  if (obj.calls !== "unlimited" && typeof obj.calls !== "number") {
    throw new ValidationError(
      `Expected "${prefix}.calls" to be a number or "unlimited".`,
      `${prefix}.calls`,
    );
  }

  return value as unknown as SubscriptionPlan;
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parse and validate an unknown value as a `PaymentRequired` response body.
 *
 * Use this on the client side to safely parse the JSON body of a
 * 402 response. Throws a `ValidationError` with a descriptive message
 * if the input does not conform to the schema.
 *
 * @param body - The raw parsed JSON body (typically from `response.json()`).
 * @returns A validated `PaymentRequired` object.
 * @throws {ValidationError} If the input is invalid.
 *
 * @example
 * ```typescript
 * const response = await fetch(url);
 * if (response.status === 402) {
 *   const body = await response.json();
 *   const paymentRequired = parsePaymentRequired(body);
 *   // paymentRequired is now strongly typed
 * }
 * ```
 */
export function parsePaymentRequired(body: unknown): PaymentRequired {
  assertObject(body, "body");

  const obj = body as Record<string, unknown>;

  // type
  if (obj.type !== "payment_required") {
    throw new ValidationError(
      `Expected "type" to be "payment_required", got "${String(obj.type)}".`,
      "type",
    );
  }

  // version
  if (obj.version !== "1.0") {
    throw new ValidationError(
      `Expected "version" to be "1.0", got "${String(obj.version)}".`,
      "version",
    );
  }

  // resource
  assertString(obj.resource, "resource");

  // pricing
  assertObject(obj.pricing, "pricing");
  const pricing = obj.pricing as Record<string, unknown>;
  assertString(pricing.amount, "pricing.amount");
  assertString(pricing.currency, "pricing.currency");
  assertString(pricing.unit, "pricing.unit");

  if (!VALID_UNITS.has(pricing.unit as string)) {
    throw new ValidationError(
      `Invalid pricing unit "${pricing.unit as string}". Expected one of: ${[...VALID_UNITS].join(", ")}.`,
      "pricing.unit",
    );
  }

  if (pricing.description !== undefined) {
    assertString(pricing.description, "pricing.description");
  }

  // methods
  assertArray(obj.methods, "methods");
  if ((obj.methods as unknown[]).length === 0) {
    throw new ValidationError(
      "At least one payment method is required.",
      "methods",
    );
  }
  const methods = (obj.methods as unknown[]).map(validateMethod);

  // subscriptions (optional)
  let subscriptions: SubscriptionPlan[] | undefined;
  if (obj.subscriptions !== undefined) {
    assertArray(obj.subscriptions, "subscriptions");
    subscriptions = (obj.subscriptions as unknown[]).map(
      validateSubscription,
    );
  }

  // meta (optional — loosely validated)
  if (obj.meta !== undefined) {
    assertObject(obj.meta, "meta");
  }

  const result: PaymentRequired = {
    type: "payment_required",
    version: "1.0",
    resource: obj.resource as string,
    pricing: {
      amount: pricing.amount as string,
      currency: pricing.currency as string,
      unit: pricing.unit as "per_request" | "per_kb" | "per_second" | "per_unit",
      ...(pricing.description !== undefined
        ? { description: pricing.description as string }
        : {}),
    },
    methods,
  };

  if (subscriptions) {
    result.subscriptions = subscriptions;
  }

  if (obj.meta !== undefined) {
    result.meta = obj.meta as PaymentRequired["meta"];
  }

  return result;
}
