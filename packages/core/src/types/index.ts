/**
 * @module types
 *
 * Re-exports all OpenAgentPay core types.
 */

export type {
  PaymentRequired,
  PaymentRequiredPricing,
  PaymentRequiredMeta,
  PaymentMethod,
  X402PaymentMethod,
  CreditsPaymentMethod,
  StripePaymentMethod,
  PayPalPaymentMethod,
  UPIPaymentMethod,
  MPPPaymentMethod,
  SolanaPaymentMethod,
  LightningPaymentMethod,
  VisaPaymentMethod,
  SubscriptionPlan,
} from "./payment-required.js";

export type {
  AgentPaymentReceipt,
  Payer,
  Payee,
  RequestSummary,
  PaymentDetails,
  ResponseSummary,
  PolicyDecision,
} from "./receipt.js";

export type {
  PaymentAdapter,
  VerifyResult,
  PaymentProof,
  Pricing,
  AdapterConfig,
  IncomingRequest,
} from "./adapter.js";

export type {
  Subscription,
  SubscriptionStore,
  SubscriptionPreAuth,
  SubscriptionStatus,
  SubscriptionPeriod,
} from "./subscription.js";

export type {
  PolicyConfig,
  PolicyEvaluation,
  PolicyDecisionOutcome,
  PolicyRule,
} from "./policy.js";

export type {
  AgentPayDiscovery,
  DiscoveryEndpoint,
} from "./discovery.js";

export type {
  AgentDID,
  AgentAttestation,
  AgentIdentityConfig,
  KYAProfile,
} from "./identity.js";

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
} from "./errors.js";
