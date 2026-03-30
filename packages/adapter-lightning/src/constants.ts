/**
 * @module constants
 *
 * Lightning Network constants for the adapter.
 *
 * Contains default configuration values, conversion factors,
 * and the HTTP header name for Lightning payment proofs.
 */

// ---------------------------------------------------------------------------
// Invoice Defaults
// ---------------------------------------------------------------------------

/**
 * Default invoice expiry in seconds (10 minutes).
 *
 * BOLT11 invoices include an expiry after which the payment
 * request is no longer valid. 600 seconds is a reasonable
 * default for API micropayments.
 */
export const DEFAULT_INVOICE_EXPIRY = 600

// ---------------------------------------------------------------------------
// Bitcoin Unit Conversion
// ---------------------------------------------------------------------------

/**
 * Number of satoshis in one bitcoin.
 *
 * 1 BTC = 100,000,000 satoshis.
 */
export const SATS_PER_BTC = 100_000_000

// ---------------------------------------------------------------------------
// HTTP Header
// ---------------------------------------------------------------------------

/**
 * Header name for Lightning payment proofs.
 *
 * The client sends the base64-encoded payment proof in this header
 * on the retry request after paying the BOLT11 invoice.
 */
export const LIGHTNING_PAYMENT_HEADER = 'x-lightning-payment'

// ---------------------------------------------------------------------------
// LND REST API Paths
// ---------------------------------------------------------------------------

/**
 * LND REST API path for creating invoices.
 */
export const LND_ADD_INVOICE_PATH = '/v1/invoices'

/**
 * LND REST API path for looking up an invoice by payment hash.
 *
 * Usage: `GET /v1/invoice/{r_hash_str}`
 */
export const LND_LOOKUP_INVOICE_PATH = '/v1/invoice'

/**
 * LND REST API path for sending payments (paying invoices).
 *
 * Usage: `POST /v1/channels/transactions`
 */
export const LND_SEND_PAYMENT_PATH = '/v1/channels/transactions'

/**
 * HTTP timeout for LND REST API requests in milliseconds.
 */
export const LND_HTTP_TIMEOUT_MS = 15_000
