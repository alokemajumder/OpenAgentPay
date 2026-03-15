/**
 * @openagentpay/core
 *
 * Foundational types, builders, parsers, and utilities for the
 * OpenAgentPay SDK — the payment infrastructure for AI agents.
 *
 * This package has zero external dependencies and provides:
 *
 * - **Types** — PaymentRequired, AgentPaymentReceipt, PaymentAdapter,
 *   SubscriptionPlan, PolicyConfig, and typed error classes
 * - **Builders** — construct valid 402 response bodies and receipts
 * - **Parsers** — validate unknown input into strongly-typed objects
 * - **Utils** — ULID generation and SHA-256 hashing
 *
 * @packageDocumentation
 */

// Types
export type {
  PaymentRequired,
  PaymentRequiredPricing,
  PaymentRequiredMeta,
  PaymentMethod,
  X402PaymentMethod,
  CreditsPaymentMethod,
  SubscriptionPlan,
  AgentPaymentReceipt,
  Payer,
  Payee,
  RequestSummary,
  PaymentDetails,
  ResponseSummary,
  PolicyDecision,
  PaymentAdapter,
  VerifyResult,
  PaymentProof,
  Pricing,
  AdapterConfig,
  IncomingRequest,
  Subscription,
  SubscriptionStore,
  SubscriptionPreAuth,
  SubscriptionStatus,
  SubscriptionPeriod,
  PolicyConfig,
  PolicyEvaluation,
  PolicyDecisionOutcome,
  PolicyRule,
} from "./types/index.js";

// Error classes (value exports — usable with instanceof)
export {
  OpenAgentPayError,
  PaymentRequiredError,
  InsufficientAmountError,
  PaymentReplayError,
  PaymentExpiredError,
  PolicyDeniedError,
  SubscriptionExpiredError,
  SubscriptionExhaustedError,
  FacilitatorUnavailableError,
  ValidationError,
} from "./types/index.js";

// Builders
export {
  buildPaymentRequired,
  type BuildPaymentRequiredConfig,
  buildReceipt,
  type BuildReceiptConfig,
} from "./builders/index.js";

// Parsers
export { parsePaymentRequired } from "./parsers/index.js";

// Utils
export { ulid, extractTimestamp } from "./utils/ulid.js";
export { sha256, sha256Prefixed } from "./utils/hash.js";
