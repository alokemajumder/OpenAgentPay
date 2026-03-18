/**
 * @module cascade
 *
 * CascadeManager — automatic failover to the next adapter when a
 * payment attempt fails. Executes adapters in rank order until one
 * succeeds or all attempts are exhausted.
 */

import type { PaymentAdapter } from '@openagentpay/core';
import type { CascadeAttempt, CascadeResult } from './types.js';

// ---------------------------------------------------------------------------
// CascadeManager
// ---------------------------------------------------------------------------

/**
 * Manages automatic retry/failover across ranked adapters.
 *
 * Given an ordered list of adapters and a payment execution function,
 * the cascade manager tries each adapter in sequence until one
 * succeeds or the maximum number of attempts is reached.
 */
export class CascadeManager {
  private readonly maxAttempts: number;

  /**
   * @param maxAttempts - Maximum number of adapters to try. Default: 3.
   */
  constructor(maxAttempts: number = 3) {
    this.maxAttempts = maxAttempts;
  }

  /**
   * Execute a payment with automatic cascade on failure.
   *
   * @param rankedAdapters - Adapters in preference order (best first).
   * @param executePayment - Function that attempts payment with a given adapter.
   *   Must return `{ success: true }` or `{ success: false, error: string }`.
   * @param onAttempt - Optional callback fired before each attempt.
   * @returns Result with the successful adapter and full attempt log.
   */
  async executeWithCascade(
    rankedAdapters: PaymentAdapter[],
    executePayment: (adapter: PaymentAdapter) => Promise<{ success: boolean; error?: string }>,
    onAttempt?: (adapter: PaymentAdapter, attemptNumber: number) => void,
  ): Promise<CascadeResult> {
    const attempts: CascadeAttempt[] = [];
    const limit = Math.min(this.maxAttempts, rankedAdapters.length);

    for (let i = 0; i < limit; i++) {
      const adapter = rankedAdapters[i]!;
      const attemptNumber = i + 1;

      if (onAttempt) {
        onAttempt(adapter, attemptNumber);
      }

      const startTime = Date.now();

      try {
        const result = await executePayment(adapter);
        const latencyMs = Date.now() - startTime;

        attempts.push({
          adapterType: adapter.type,
          attemptNumber,
          success: result.success,
          error: result.error,
          latencyMs,
        });

        if (result.success) {
          return {
            success: true,
            adapter,
            attempts,
          };
        }
      } catch (err: unknown) {
        const latencyMs = Date.now() - startTime;
        const errorMessage = err instanceof Error ? err.message : String(err);

        attempts.push({
          adapterType: adapter.type,
          attemptNumber,
          success: false,
          error: errorMessage,
          latencyMs,
        });
      }
    }

    // All attempts exhausted
    return {
      success: false,
      adapter: undefined,
      attempts,
    };
  }
}
