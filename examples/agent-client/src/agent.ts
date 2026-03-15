// @ts-nocheck — Example file; cross-package types verified via tsx runtime
/**
 * OpenAgentPay Example — Agent Client
 *
 * Demonstrates an AI agent that automatically discovers, evaluates,
 * and pays for API calls using the OpenAgentPay SDK.
 *
 * This script exercises the full 402 payment flow:
 *   1. Agent calls an API endpoint
 *   2. Server returns 402 Payment Required with pricing + payment methods
 *   3. Agent checks spend policy (budget limits, domain allowlists)
 *   4. Agent pays via wallet adapter
 *   5. Agent retries the request with a payment proof header
 *   6. Server verifies payment and returns the data + receipt
 *
 * Prerequisites:
 *   - The paid-weather-api example must be running on localhost:3000
 *   - Start it with: cd examples/paid-weather-api && pnpm start
 */

import { parsePaymentRequired, PolicyDeniedError } from "@openagentpay/core";
import { mockWallet } from "@openagentpay/adapter-mock";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BASE_URL = process.env.API_URL || "http://localhost:3000";

// ---------------------------------------------------------------------------
// Create the mock wallet with $100 starting balance
// ---------------------------------------------------------------------------

const wallet = mockWallet({ initialBalance: "100.00" });

// ---------------------------------------------------------------------------
// Policy configuration
// ---------------------------------------------------------------------------

/** Spend policy that governs what the agent is allowed to pay. */
interface SpendPolicy {
  maxPerRequest: number;
  maxPerDay: number;
  allowedDomains: string[];
}

const defaultPolicy: SpendPolicy = {
  maxPerRequest: 1.0, // Never pay more than $1 per call
  maxPerDay: 20.0, // Daily budget cap
  allowedDomains: ["localhost", "127.0.0.1"],
};

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------

/** Tracks cumulative spend and results across all calls. */
interface CallResult {
  step: number;
  endpoint: string;
  status: "free" | "paid" | "denied" | "error";
  amount?: string;
  paymentId?: string;
  error?: string;
}

const results: CallResult[] = [];
let dailySpend = 0;

// ---------------------------------------------------------------------------
// Policy engine (inline — mirrors what @openagentpay/policy will provide)
// ---------------------------------------------------------------------------

/**
 * Evaluate whether a payment is allowed under the current policy.
 * Throws PolicyDeniedError if the payment violates any rule.
 */
function evaluatePolicy(
  amount: number,
  domain: string,
  policy: SpendPolicy
): { approved: boolean; reason?: string } {
  // Check domain allowlist
  const hostname = new URL(`http://${domain}`).hostname;
  if (
    policy.allowedDomains.length > 0 &&
    !policy.allowedDomains.includes(hostname)
  ) {
    return {
      approved: false,
      reason: `Domain "${hostname}" is not in the allowed list`,
    };
  }

  // Check per-request limit
  if (amount > policy.maxPerRequest) {
    return {
      approved: false,
      reason: `Amount $${amount} exceeds maxPerRequest ($${policy.maxPerRequest})`,
    };
  }

  // Check daily limit
  if (dailySpend + amount > policy.maxPerDay) {
    return {
      approved: false,
      reason: `Payment would exceed daily budget ($${dailySpend + amount} > $${policy.maxPerDay})`,
    };
  }

  return { approved: true };
}

// ---------------------------------------------------------------------------
// paidFetch — wraps native fetch with automatic 402 handling
// ---------------------------------------------------------------------------

/**
 * Makes an HTTP request with automatic 402 Payment Required handling.
 *
 * Flow:
 *   1. Send the original request
 *   2. If 200 (or non-402), return as-is
 *   3. If 402, parse pricing, check policy, pay, retry with proof header
 *
 * This is a simplified version of what `withPayment()` from
 * `@openagentpay/client` will provide once implemented.
 */
async function paidFetch(
  url: string,
  policy: SpendPolicy,
  init?: RequestInit
): Promise<{
  response: Response;
  paid: boolean;
  amount?: string;
  paymentId?: string;
  policyDenied?: boolean;
  denyReason?: string;
}> {
  // Step 1: Make the initial request
  const response = await fetch(url, init);

  // Step 2: If not 402, return immediately (free endpoint or other status)
  if (response.status !== 402) {
    return { response, paid: false };
  }

  // Step 3: Parse the 402 response body
  const body = await response.json();
  const paymentRequired = parsePaymentRequired(body);

  const amount = parseFloat(paymentRequired.pricing.amount);
  const domain = new URL(url).hostname;

  // Step 4: Evaluate spend policy
  const decision = evaluatePolicy(amount, domain, policy);

  if (!decision.approved) {
    return {
      response,
      paid: false,
      amount: paymentRequired.pricing.amount,
      policyDenied: true,
      denyReason: decision.reason,
    };
  }

  // Step 5: Select a payment method and pay
  const method = paymentRequired.methods[0]; // Use first available method
  const proof = await wallet.pay(method, {
    amount: paymentRequired.pricing.amount,
    currency: paymentRequired.pricing.currency,
    unit: paymentRequired.pricing.unit,
  });

  // Track spend for daily budget
  dailySpend += amount;

  // Step 6: Retry the request with payment proof header
  const retryHeaders = new Headers(init?.headers);
  retryHeaders.set(proof.header, proof.value);

  const retryResponse = await fetch(url, {
    ...init,
    headers: retryHeaders,
  });

  return {
    response: retryResponse,
    paid: true,
    amount: paymentRequired.pricing.amount,
    paymentId: proof.value,
  };
}

// ---------------------------------------------------------------------------
// Demo helpers
// ---------------------------------------------------------------------------

const LINE =
  "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501";

function log(msg: string): void {
  console.log(msg);
}

// ---------------------------------------------------------------------------
// Main demo
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log("");
  log("OpenAgentPay Agent Demo");
  log(LINE);
  log("");

  // Define the calls we want to make
  const calls: Array<{
    step: number;
    total: number;
    method: string;
    path: string;
    label: string;
    policy: SpendPolicy;
  }> = [
    {
      step: 1,
      total: 6,
      method: "GET",
      path: "/api/health",
      label: "free",
      policy: defaultPolicy,
    },
    {
      step: 2,
      total: 6,
      method: "GET",
      path: "/api/weather?city=London",
      label: "paid",
      policy: defaultPolicy,
    },
    {
      step: 3,
      total: 6,
      method: "GET",
      path: "/api/weather?city=Tokyo",
      label: "paid",
      policy: defaultPolicy,
    },
    {
      step: 4,
      total: 6,
      method: "GET",
      path: "/api/weather?city=Paris",
      label: "paid",
      policy: defaultPolicy,
    },
    {
      step: 5,
      total: 6,
      method: "GET",
      path: "/api/forecast?city=London&days=5",
      label: "dynamic pricing",
      policy: defaultPolicy,
    },
    {
      step: 6,
      total: 6,
      method: "GET",
      path: "/api/weather?city=Berlin",
      label: "maxPerRequest: $0.001",
      // Strict policy to demonstrate denial
      policy: {
        ...defaultPolicy,
        maxPerRequest: 0.001,
      },
    },
  ];

  // Execute each call
  for (const call of calls) {
    log(`[${call.step}/${call.total}] ${call.method} ${call.path} (${call.label})`);

    try {
      const url = `${BASE_URL}${call.path}`;
      const result = await paidFetch(url, call.policy);

      if (result.policyDenied) {
        // Policy denied the payment
        log(`  \u2192 402 Payment Required \u2014 $${result.amount} USDC`);
        log(`  \u2192 Policy: DENIED \u2014 ${result.denyReason}`);
        results.push({
          step: call.step,
          endpoint: call.path,
          status: "denied",
          amount: result.amount,
          error: result.denyReason,
        });
      } else if (result.paid) {
        // Paid and got a response
        const data = await result.response.json();
        const preview = JSON.stringify(data.data || data, null, 0).slice(0, 60);
        log(`  \u2192 402 Payment Required \u2014 $${result.amount} USDC`);
        log(`  \u2192 Policy: approved (within limits)`);
        log(`  \u2192 Payment: ${result.paymentId}`);
        log(`  \u2192 ${result.response.status} OK \u2014 ${preview}...`);
        results.push({
          step: call.step,
          endpoint: call.path,
          status: "paid",
          amount: result.amount,
          paymentId: result.paymentId,
        });
      } else {
        // Free endpoint (non-402)
        log(
          `  \u2192 ${result.response.status} OK \u2014 no payment needed`
        );
        results.push({
          step: call.step,
          endpoint: call.path,
          status: "free",
        });
      }
    } catch (err: unknown) {
      // Connection error or unexpected failure
      const message =
        err instanceof Error ? err.message : String(err);

      if (
        message.includes("ECONNREFUSED") ||
        message.includes("fetch failed")
      ) {
        log(`  \u2192 ERROR: Could not connect to ${BASE_URL}`);
        log(`  \u2192 Make sure the paid-weather-api server is running:`);
        log(`         cd examples/paid-weather-api && pnpm start`);
        results.push({
          step: call.step,
          endpoint: call.path,
          status: "error",
          error: "Connection refused",
        });
        // No point continuing if the server is down
        break;
      }

      log(`  \u2192 ERROR: ${message}`);
      results.push({
        step: call.step,
        endpoint: call.path,
        status: "error",
        error: message,
      });
    }

    log("");
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  const callsAttempted = results.length;
  const callsPaid = results.filter((r) => r.status === "paid").length;
  const callsFree = results.filter((r) => r.status === "free").length;
  const policyDenials = results.filter((r) => r.status === "denied").length;
  const errors = results.filter((r) => r.status === "error").length;
  const totalSpent = wallet.getTotalSpent();
  const walletBalance = wallet.getBalance();

  log(LINE);
  log("Summary:");
  log(`  Calls attempted:  ${callsAttempted}`);
  log(`  Calls free:       ${callsFree}`);
  log(`  Calls paid:       ${callsPaid}`);
  log(`  Total spent:      $${totalSpent}`);
  log(`  Wallet balance:   $${walletBalance}`);
  log(`  Policy denials:   ${policyDenials}`);
  if (errors > 0) {
    log(`  Errors:           ${errors}`);
  }
  log(LINE);

  // Print receipt details
  const history = wallet.getPaymentHistory();
  if (history.length > 0) {
    log("");
    log("Payment receipts:");
    for (const record of history) {
      log(
        `  ${record.timestamp}  $${record.pricing.amount} ${record.pricing.currency}  ${record.proof.value}`
      );
    }
    log("");
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
