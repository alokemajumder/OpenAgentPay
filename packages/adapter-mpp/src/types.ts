/**
 * @module types
 *
 * Types for the MPP (Machine Payments Protocol) adapter.
 *
 * Aligned with the IETF draft `draft-ryan-httpauth-payment` and
 * the official mpp-specs from Tempo/Stripe.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the server-side MPP adapter.
 */
export interface MPPAdapterConfig {
  /** Payment networks accepted by this server (e.g., ['tempo', 'stripe', 'lightning']). */
  networks?: string[];

  /** Default TTL for challenges in seconds. Defaults to 300 (5 minutes). */
  challengeTtlSeconds?: number;

  /** Whether MPP sessions are supported. Defaults to false. */
  sessionsSupported?: boolean;

  /** Whether streaming payments are supported. Defaults to false. */
  streamingSupported?: boolean;

  /** Tempo RPC URL for verifying on-chain payments. */
  tempoRpcUrl?: string;

  /** Stripe secret key for verifying Stripe-based MPP payments. */
  stripeSecretKey?: string;

  /** Lightning node URL for verifying BOLT11 payments. */
  lightningNodeUrl?: string;

  /** Lightning node macaroon for authentication. */
  lightningMacaroon?: string;

  /** Minimum session amount allowed. Defaults to '0.01'. */
  minSessionAmount?: string;

  /** Maximum session duration in hours. Defaults to 24. */
  maxSessionDurationHours?: number;
}

/**
 * Configuration for the client-side MPP wallet.
 */
export interface MPPWalletConfig {
  /** Payment network to use: 'tempo', 'stripe', or 'lightning'. */
  network: 'tempo' | 'stripe' | 'lightning';

  /** Private key for Tempo on-chain payments. */
  tempoPrivateKey?: string;

  /** Tempo RPC URL for submitting transactions. */
  tempoRpcUrl?: string;

  /** Stripe payment method or token for Stripe-based MPP payments. */
  stripePaymentMethod?: string;

  /** Stripe publishable key. */
  stripePublishableKey?: string;

  /** Lightning node URL for paying BOLT11 invoices. */
  lightningNodeUrl?: string;

  /** Lightning node macaroon for authentication. */
  lightningMacaroon?: string;

  /** Payer identifier (wallet address or account). */
  payerIdentifier?: string;

  /** Whether to prefer sessions over per-call payments when available. */
  preferSessions?: boolean;

  /** Default session budget when auto-creating sessions. */
  defaultSessionBudget?: string;

  /** Default session duration when auto-creating sessions. */
  defaultSessionDuration?: string;
}

// ---------------------------------------------------------------------------
// Protocol Types
// ---------------------------------------------------------------------------

/**
 * An MPP Challenge issued by a server in a 402 response.
 *
 * The Challenge tells the client what to pay, how much, and which
 * payment networks are accepted. Follows the IETF `Payment` auth
 * scheme challenge format.
 */
export interface MPPChallenge {
  /** Protocol version. */
  version: '1.0';

  /** Unique identifier for this challenge. */
  challengeId: string;

  /** Payment amount as a decimal string (e.g., '0.01'). */
  amount: string;

  /** Currency code (e.g., 'USD', 'USDC'). */
  currency: string;

  /** Recipient wallet address or account identifier. */
  recipient: string;

  /** Accepted payment networks. */
  networks: string[];

  /** Expiry timestamp in ISO 8601 format. */
  expiresAt: string;

  /** Whether the server supports payment sessions. */
  sessionSupported?: boolean;

  /** Whether the server supports streaming payments. */
  streamingSupported?: boolean;

  /** Resource URI being requested. */
  resource?: string;

  /** Additional metadata from the server. */
  metadata?: Record<string, string>;
}

/**
 * An MPP Credential submitted by a client as proof of payment.
 *
 * The Credential references a Challenge by ID and includes proof
 * that payment was made on a specific network.
 */
export interface MPPCredential {
  /** Protocol version. */
  version: '1.0';

  /** Challenge ID this credential responds to. Must match the original challenge. */
  challengeId: string;

  /** Payment network used. */
  network: string;

  /** Proof of payment — contents depend on the network. */
  proof: {
    /** On-chain transaction hash (for tempo). */
    transactionHash?: string;
    /** Stripe PaymentIntent ID (for stripe). */
    paymentIntentId?: string;
    /** BOLT11 payment preimage (for lightning). */
    preimage?: string;
  };

  /** Payer identity (wallet address or account). */
  payer: string;

  /** ISO 8601 timestamp of when the credential was created. */
  timestamp: string;
}

/**
 * An MPP Receipt returned by the server after successful payment verification.
 */
export interface MPPReceipt {
  /** Unique receipt identifier. */
  receiptId: string;

  /** Challenge ID that was fulfilled. */
  challengeId: string;

  /** Amount paid. */
  amount: string;

  /** Currency. */
  currency: string;

  /** Payment network used. */
  network: string;

  /** Transaction reference (hash, intent ID, or preimage). */
  transactionRef: string;

  /** ISO 8601 timestamp. */
  timestamp: string;

  /** Settlement status. */
  status: 'settled' | 'pending';
}

// ---------------------------------------------------------------------------
// Session Types
// ---------------------------------------------------------------------------

/**
 * An MPP Session — "OAuth for money".
 *
 * Sessions enable agents to authorize a payment budget upfront and
 * then make multiple requests without per-call authorization.
 */
export interface MPPSession {
  /** Unique session identifier. */
  sessionId: string;

  /** Maximum amount authorized for this session. */
  maxAmount: string;

  /** Amount spent so far. */
  spent: string;

  /** Currency. */
  currency: string;

  /** Session expiry (ISO 8601). */
  expiresAt: string;

  /** Payment network used. */
  network: string;

  /** Whether session is active. */
  active: boolean;
}

/**
 * Configuration for creating a new MPP session.
 */
export interface MPPSessionConfig {
  /** Maximum amount to authorize for the session. */
  maxAmount: string;

  /** Currency code. */
  currency: string;

  /** Payment network to use. */
  network: string;

  /** Recipient wallet address or account. */
  recipient: string;

  /** Session duration (e.g., '1h', '24h'). Defaults to '1h'. */
  duration?: string;
}

/**
 * Result of charging against an active session.
 */
export interface MPPSessionChargeResult {
  /** Receipt identifier for this charge. */
  receipt: string;

  /** Remaining balance in the session. */
  remaining: string;
}

/**
 * Result of closing a session.
 */
export interface MPPSessionCloseResult {
  /** Amount refunded (remaining balance at close time). */
  refunded: string;
}

// ---------------------------------------------------------------------------
// Streaming Types
// ---------------------------------------------------------------------------

/**
 * Configuration for a streaming payment — incremental charges during
 * a long-running request (e.g., LLM token generation).
 */
export interface MPPStreamConfig {
  /** Session ID to charge against. */
  sessionId: string;

  /** Amount per chunk/token as a decimal string (e.g., '0.0001'). */
  amountPerChunk: string;

  /** Maximum total amount for this stream. */
  maxTotal?: string;

  /** Currency code. */
  currency: string;
}

/**
 * A streaming payment meter that tracks incremental charges.
 */
export interface MPPStreamMeter {
  /** Stream identifier. */
  streamId: string;

  /** Session being charged. */
  sessionId: string;

  /** Number of chunks charged. */
  chunksCharged: number;

  /** Total amount charged so far. */
  totalCharged: string;

  /** Whether the stream is still active. */
  active: boolean;
}

// ---------------------------------------------------------------------------
// IETF Payment Auth Scheme Types
// ---------------------------------------------------------------------------

/**
 * WWW-Authenticate header parameters for the MPP `Payment` scheme.
 *
 * Per IETF draft-ryan-httpauth-payment, the 402 response includes:
 *   WWW-Authenticate: Payment realm="...", challenge="base64(...)"
 */
export interface MPPWWWAuthenticateParams {
  /** Realm identifying the payment domain. */
  realm: string;

  /** Base64-encoded MPP challenge. */
  challenge: string;

  /** Comma-separated list of accepted networks. */
  networks: string;

  /** Whether sessions are available. */
  sessions?: boolean;

  /** Whether streaming is available. */
  streaming?: boolean;
}

/**
 * Payment-Receipt response header data.
 *
 * Per the IETF draft, successful payments include a receipt
 * in the `Payment-Receipt` response header.
 */
export interface MPPPaymentReceiptHeader {
  /** Receipt ID. */
  id: string;

  /** Amount settled. */
  amount: string;

  /** Currency. */
  currency: string;

  /** Network used. */
  network: string;

  /** Settlement status. */
  status: 'settled' | 'pending';

  /** Transaction reference. */
  ref: string;
}
