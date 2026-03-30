/**
 * @module commands/probe
 *
 * The `agentpay probe <url>` command.
 *
 * Sends a GET request to the URL and, if the server responds with
 * HTTP 402, parses and pretty-prints the payment details.
 *
 * @packageDocumentation
 */

import { parsePaymentRequired, ValidationError } from "@openagentpay/core";
import {
  section,
  field,
  table,
  highlightJson,
  statusBadge,
  color,
  yellow,
  green,
  gray,
  dim,
  b,
  reset,
  box,
} from "../formatter.js";

/**
 * Execute the probe command.
 *
 * @param url - The URL to probe for a 402 response.
 */
export async function probe(url: string): Promise<void> {
  console.log(`\n${b("Probing")} ${color(url, yellow)}...\n`);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    console.error(
      color(`  Error: Could not connect to ${url}`, "\x1b[31"),
    );
    console.error(`  ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  console.log(field("Status", `${statusBadge(response.status)} ${response.statusText}`));
  console.log(field("Content-Type", response.headers.get("content-type") ?? "(none)"));

  if (response.status !== 402) {
    console.log(
      `\n  ${dim}Response is not 402 Payment Required — nothing to parse.${reset}\n`,
    );
    return;
  }

  // Parse 402 body
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    console.error(color("  Error: Response body is not valid JSON.", "\x1b[31"));
    process.exit(1);
  }

  let parsed;
  try {
    parsed = parsePaymentRequired(body);
  } catch (err) {
    if (err instanceof ValidationError) {
      console.error(color(`  Validation error: ${err.message}`, "\x1b[31"));
    } else {
      console.error(color(`  Parse error: ${err instanceof Error ? err.message : String(err)}`, "\x1b[31"));
    }
    console.log(section("Raw Body"));
    console.log(highlightJson(body));
    process.exit(1);
  }

  // Pretty-print parsed 402 response
  console.log(section("Pricing"));
  console.log(
    table([
      ["Amount", parsed.pricing.amount],
      ["Currency", parsed.pricing.currency],
      ["Unit", parsed.pricing.unit],
      ["Description", parsed.pricing.description],
    ]),
  );

  console.log(section("Payment Methods"));
  for (let i = 0; i < parsed.methods.length; i++) {
    const method = parsed.methods[i];
    console.log(`\n  ${b(`[${i + 1}]`)} ${color(method.type, green)}`);
    const entries = Object.entries(method).filter(([k]) => k !== "type");
    for (const [key, value] of entries) {
      console.log(field(`    ${key}`, String(value)));
    }
  }

  if (parsed.subscriptions && parsed.subscriptions.length > 0) {
    console.log(section("Subscription Plans"));
    for (const plan of parsed.subscriptions) {
      console.log(`\n  ${b(plan.id)}`);
      console.log(
        table([
          ["Amount", plan.amount],
          ["Currency", plan.currency],
          ["Period", plan.period],
          ["Calls", String(plan.calls)],
          ["Rate Limit", plan.rate_limit !== undefined ? `${plan.rate_limit}/min` : undefined],
          ["Description", plan.description],
        ]),
      );
    }
  }

  if (parsed.meta) {
    console.log(section("Metadata"));
    const metaEntries = Object.entries(parsed.meta).map(
      ([k, v]) => [k, String(v)] as [string, string],
    );
    console.log(table(metaEntries));
  }

  console.log(
    `\n${dim}  Resource: ${parsed.resource}${reset}`,
  );
  console.log("");
}
