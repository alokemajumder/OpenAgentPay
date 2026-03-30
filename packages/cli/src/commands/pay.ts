/**
 * @module commands/pay
 *
 * The `agentpay pay <url> --method <type> [--wallet <key>]` command.
 *
 * Probes a URL for a 402 response, selects the specified payment
 * method, and if a wallet key is provided, attempts payment.
 *
 * @packageDocumentation
 */

import {
  parsePaymentRequired,
  ValidationError,
  type PaymentMethod,
  type PaymentRequired,
} from "@openagentpay/core";
import {
  section,
  field,
  table,
  highlightJson,
  color,
  yellow,
  green,
  red,
  gray,
  dim,
  b,
  reset,
  statusBadge,
} from "../formatter.js";

/**
 * Execute the pay command.
 *
 * @param url - The URL to pay for.
 * @param methodType - The payment method type to use.
 * @param walletKey - Optional wallet key for executing payment.
 */
export async function pay(
  url: string,
  methodType: string,
  walletKey?: string,
): Promise<void> {
  console.log(`\n${b("Pay")} ${color(url, yellow)}`);
  console.log(field("Method", methodType));
  if (walletKey) {
    const masked = walletKey.length > 8
      ? walletKey.slice(0, 4) + "..." + walletKey.slice(-4)
      : "****";
    console.log(field("Wallet", masked));
  }
  console.log("");

  // Step 1: Probe the URL
  console.log(`${dim}  Sending GET request...${reset}`);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    console.error(color("  Error: Could not connect.", "\x1b[31"));
    console.error(`  ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  console.log(field("Status", `${statusBadge(response.status)} ${response.statusText}`));

  if (response.status !== 402) {
    console.log(
      `\n  ${dim}Server did not return 402 Payment Required.${reset}`,
    );
    console.log(`  ${dim}No payment needed for this request.${reset}\n`);
    return;
  }

  // Step 2: Parse the 402 body
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    console.error(color("  Error: Response body is not valid JSON.", "\x1b[31"));
    process.exit(1);
  }

  let parsed: PaymentRequired;
  try {
    parsed = parsePaymentRequired(body);
  } catch (err) {
    if (err instanceof ValidationError) {
      console.error(color(`  Validation error: ${err.message}`, "\x1b[31"));
    } else {
      console.error(color(`  Parse error: ${err instanceof Error ? err.message : String(err)}`, "\x1b[31"));
    }
    process.exit(1);
  }

  console.log(section("Payment Required"));
  console.log(
    table([
      ["Amount", `${parsed.pricing.amount} ${parsed.pricing.currency}`],
      ["Unit", parsed.pricing.unit],
      ["Resource", parsed.resource],
    ]),
  );

  // Step 3: Find the requested method
  const selectedMethod = parsed.methods.find(
    (m) => m.type.toLowerCase() === methodType.toLowerCase(),
  );

  if (!selectedMethod) {
    const available = parsed.methods.map((m) => m.type).join(", ");
    console.error(
      color(
        `\n  Error: Method "${methodType}" not available. Available: ${available}`,
        "\x1b[31",
      ),
    );
    process.exit(1);
  }

  console.log(section("Selected Method"));
  console.log(highlightJson(selectedMethod));

  // Step 4: Attempt payment if wallet provided
  if (!walletKey) {
    console.log(
      `\n  ${color("No --wallet provided.", yellow)} Payment was not executed.`,
    );
    console.log(
      `  ${dim}Pass --wallet <key> to attempt payment with a mock adapter.${reset}\n`,
    );
    return;
  }

  // Execute payment with mock proof header
  console.log(`\n${dim}  Executing payment...${reset}`);

  const proofHeader = "X-PAYMENT";
  const proofValue = `mock:${walletKey.slice(0, 8)}-${Date.now()}`;

  let paidResponse: Response;
  try {
    paidResponse = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        [proofHeader]: proofValue,
      },
    });
  } catch (err) {
    console.error(color("  Error: Retry request failed.", "\x1b[31"));
    console.error(`  ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  console.log(section("Payment Response"));
  console.log(field("Status", `${statusBadge(paidResponse.status)} ${paidResponse.statusText}`));
  console.log(field("Proof Header", `${proofHeader}: ${proofValue}`));

  // Show response body if available
  const contentType = paidResponse.headers.get("content-type") ?? "";
  if (contentType.includes("json")) {
    try {
      const responseBody = await paidResponse.json();
      console.log(section("Response Body"));
      console.log(highlightJson(responseBody));
    } catch {
      // Ignore body parse errors
    }
  }

  // Build a simple receipt summary
  console.log(section("Receipt Summary"));
  console.log(
    table([
      ["URL", url],
      ["Amount", `${parsed.pricing.amount} ${parsed.pricing.currency}`],
      ["Method", selectedMethod.type],
      ["Response Status", String(paidResponse.status)],
      ["Timestamp", new Date().toISOString()],
    ]),
  );

  console.log("");
}
