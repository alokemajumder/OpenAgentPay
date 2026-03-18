/**
 * @module types
 *
 * Type definitions for the OpenAgentPay intelligent routing engine.
 */

import type { PaymentAdapter } from '@openagentpay/core';

// ---------------------------------------------------------------------------
// Routing Strategy
// ---------------------------------------------------------------------------

/**
 * Available routing strategies for adapter selection.
 *
 * - `priority`        — static priority order (current default behavior)
 * - `lowest-cost`     — select cheapest adapter for the transaction amount
 * - `highest-success` — select adapter with best recent success rate
 * - `lowest-latency`  — select adapter with lowest recent average latency
 * - `round-robin`     — distribute evenly across healthy adapters
 * - `weighted`        — probabilistic selection by weight (for A/B testing)
 * - `smart`           — composite scoring: success*0.5 + cost*0.3 + latency*0.2
 */
export type RoutingStrategy =
  | 'priority'
  | 'lowest-cost'
  | 'highest-success'
  | 'lowest-latency'
  | 'round-robin'
  | 'weighted'
  | 'smart';

// ---------------------------------------------------------------------------
// Adapter Entry
// ---------------------------------------------------------------------------

/**
 * Configuration for a registered adapter within the router.
 */
export interface AdapterEntry {
  /** The payment adapter instance. */
  adapter: PaymentAdapter;

  /** Static priority (lower = higher priority). Default: 0 */
  priority?: number;

  /** Whether this adapter is enabled. Default: true */
  enabled?: boolean;

  /** Estimated cost per transaction (for cost-based routing). */
  costPerTransaction?: string;

  /** Estimated percentage fee. */
  costPercentage?: number;

  /** Minimum viable transaction amount for this adapter. */
  minimumAmount?: string;

  /** Maximum transaction amount. */
  maximumAmount?: string;

  /** Supported currencies. */
  currencies?: string[];

  /** Supported regions/countries. */
  regions?: string[];

  /** Weight for weighted routing (0-100). */
  weight?: number;
}

// ---------------------------------------------------------------------------
// Router Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the SmartRouter.
 */
export interface RouterConfig {
  /** Registered adapters with their configuration. */
  adapters: AdapterEntry[];

  /** Default routing strategy. */
  strategy?: RoutingStrategy;

  /** Whether to enable automatic cascade/failover. */
  cascade?: boolean;

  /** Maximum cascade attempts. Default: 3 */
  maxCascadeAttempts?: number;

  /** Health check window (ms). Default: 300000 (5 min) */
  healthWindowMs?: number;

  /** Minimum success rate to consider adapter healthy. Default: 0.5 */
  minSuccessRate?: number;
}

// ---------------------------------------------------------------------------
// Adapter Health
// ---------------------------------------------------------------------------

/**
 * Health metrics for a single adapter, computed over a sliding time window.
 */
export interface AdapterHealth {
  /** Adapter type identifier. */
  adapterType: string;

  /** Success rate from 0.0 to 1.0. */
  successRate: number;

  /** Average latency in milliseconds. */
  avgLatencyMs: number;

  /** 95th percentile latency in milliseconds. */
  p95LatencyMs: number;

  /** Total attempts within the window. */
  totalAttempts: number;

  /** Number of recent successes within the window. */
  recentSuccesses: number;

  /** Number of recent failures within the window. */
  recentFailures: number;

  /** Error message from the most recent failure. */
  lastFailureError?: string;

  /** ISO 8601 timestamp of the most recent success. */
  lastSuccessAt?: string;

  /** ISO 8601 timestamp of the most recent failure. */
  lastFailureAt?: string;

  /** Whether the adapter is considered healthy. */
  isHealthy: boolean;
}

// ---------------------------------------------------------------------------
// Cost Estimate
// ---------------------------------------------------------------------------

/**
 * Estimated cost of using an adapter for a given transaction.
 */
export interface CostEstimate {
  /** Adapter type identifier. */
  adapterType: string;

  /** Estimated fee in the same currency as the transaction. */
  transactionCost: string;

  /** Fee as a percentage of the transaction amount (e.g. "2.91"). */
  effectiveRate: string;

  /** False if the transaction amount is below the adapter's minimum. */
  isViable: boolean;

  /** Human-readable explanation when not viable. */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Route Decision
// ---------------------------------------------------------------------------

/**
 * The result of a routing decision — which adapter to use and why.
 */
export interface RouteDecision {
  /** Selected adapter. */
  adapter: PaymentAdapter;

  /** Human-readable explanation of why this adapter was selected. */
  reason: string;

  /** Estimated cost for this adapter. */
  estimatedCost: CostEstimate;

  /** Health of the selected adapter. */
  health: AdapterHealth;

  /** Alternative adapters in priority order (for cascade). */
  alternatives: PaymentAdapter[];

  /** Strategy that produced this decision. */
  strategy: RoutingStrategy;

  /** ISO 8601 timestamp of the decision. */
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Route Request
// ---------------------------------------------------------------------------

/**
 * Parameters for selecting or ranking adapters.
 */
export interface RouteRequest {
  /** Transaction amount as a decimal string. */
  amount: string;

  /** Currency code or token symbol. */
  currency: string;

  /** Target domain (for region-based filtering). */
  domain?: string;

  /** Target region/country code. */
  region?: string;
}

// ---------------------------------------------------------------------------
// Cascade Attempt
// ---------------------------------------------------------------------------

/**
 * Record of a single cascade attempt.
 */
export interface CascadeAttempt {
  /** Adapter type that was tried. */
  adapterType: string;

  /** 1-based attempt number. */
  attemptNumber: number;

  /** Whether this attempt succeeded. */
  success: boolean;

  /** Error message if the attempt failed. */
  error?: string;

  /** Time taken for this attempt in milliseconds. */
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// Cascade Result
// ---------------------------------------------------------------------------

/**
 * Result of a cascaded payment execution.
 */
export interface CascadeResult {
  /** Whether any adapter succeeded. */
  success: boolean;

  /** The adapter that succeeded (undefined if all failed). */
  adapter?: PaymentAdapter;

  /** Log of all attempts made. */
  attempts: CascadeAttempt[];
}
