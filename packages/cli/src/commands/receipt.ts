/**
 * @module commands/receipt
 *
 * The `agentpay receipt <file|json>` command.
 *
 * Parses a receipt from a file path or inline JSON string and
 * pretty-prints the fields.
 *
 * @packageDocumentation
 */

import { readFile } from "node:fs/promises";
import type { AgentPaymentReceipt } from "@openagentpay/core";
import {
  section,
  table,
  field,
  highlightJson,
  color,
  yellow,
  green,
  red,
  gray,
  dim,
  b,
  reset,
  box,
} from "../formatter.js";

/**
 * Validate that an object has the required receipt fields.
 * Returns an array of validation error messages (empty if valid).
 */
function validateReceipt(data: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (typeof data.id !== "string") errors.push("Missing or invalid 'id'");
  if (data.version !== "1.0") errors.push(`Expected version "1.0", got "${String(data.version)}"`);
  if (typeof data.timestamp !== "string") errors.push("Missing or invalid 'timestamp'");

  if (typeof data.payer !== "object" || data.payer === null) {
    errors.push("Missing 'payer' object");
  }
  if (typeof data.payee !== "object" || data.payee === null) {
    errors.push("Missing 'payee' object");
  }
  if (typeof data.request !== "object" || data.request === null) {
    errors.push("Missing 'request' object");
  }
  if (typeof data.payment !== "object" || data.payment === null) {
    errors.push("Missing 'payment' object");
  }
  if (typeof data.response !== "object" || data.response === null) {
    errors.push("Missing 'response' object");
  }

  return errors;
}

/**
 * Execute the receipt command.
 *
 * @param input - A file path or inline JSON string.
 */
export async function receipt(input: string): Promise<void> {
  console.log(`\n${b("Parsing receipt")}...\n`);

  let raw: string;

  // Determine if input is a file path or inline JSON
  if (input.trim().startsWith("{")) {
    raw = input;
  } else {
    try {
      raw = await readFile(input, "utf-8");
    } catch (err) {
      console.error(color(`  Error: Could not read file "${input}"`, "\x1b[31"));
      console.error(`  ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    console.error(color("  Error: Input is not valid JSON.", "\x1b[31"));
    process.exit(1);
  }

  // Validate
  const errors = validateReceipt(data);
  if (errors.length > 0) {
    console.log(color("  Validation warnings:", yellow));
    for (const err of errors) {
      console.log(`    ${color("!", red)} ${err}`);
    }
    console.log("");
  }

  const r = data as unknown as AgentPaymentReceipt;

  // Header
  console.log(section("Receipt"));
  console.log(
    table([
      ["ID", r.id],
      ["Version", r.version],
      ["Timestamp", r.timestamp],
    ]),
  );

  // Payer
  if (r.payer) {
    console.log(section("Payer"));
    console.log(
      table([
        ["Type", r.payer.type],
        ["Identifier", r.payer.identifier],
        ["Agent ID", r.payer.agent_id],
        ["Organization", r.payer.organization_id],
      ]),
    );
  }

  // Payee
  if (r.payee) {
    console.log(section("Payee"));
    console.log(
      table([
        ["Identifier", r.payee.identifier],
        ["Endpoint", r.payee.endpoint],
        ["Provider", r.payee.provider_id],
      ]),
    );
  }

  // Request
  if (r.request) {
    console.log(section("Request"));
    console.log(
      table([
        ["Method", r.request.method],
        ["URL", r.request.url],
        ["Body Hash", r.request.body_hash],
        ["Tool", r.request.tool_name],
        ["Task ID", r.request.task_id],
        ["Session", r.request.session_id],
      ]),
    );
  }

  // Payment
  if (r.payment) {
    console.log(section("Payment"));
    const statusColor = r.payment.status === "settled" ? green : r.payment.status === "failed" ? red : yellow;
    console.log(
      table([
        ["Amount", r.payment.amount],
        ["Currency", r.payment.currency],
        ["Method", r.payment.method],
        ["Status", r.payment.status ? color(r.payment.status, statusColor) : undefined],
        ["Tx Hash", r.payment.transaction_hash],
        ["Network", r.payment.network],
      ]),
    );
  }

  // Response
  if (r.response) {
    console.log(section("Response"));
    console.log(
      table([
        ["Status Code", r.response.status_code],
        ["Content Hash", r.response.content_hash],
        ["Content Length", r.response.content_length ? `${r.response.content_length} bytes` : undefined],
        ["Latency", r.response.latency_ms ? `${r.response.latency_ms}ms` : undefined],
      ]),
    );
  }

  // Policy
  if (r.policy) {
    console.log(section("Policy Decision"));
    console.log(
      table([
        ["Decision", r.policy.decision],
        ["Rules Evaluated", r.policy.rules_evaluated?.join(", ")],
        ["Budget Remaining", r.policy.budget_remaining],
      ]),
    );
  }

  // Signature
  if (r.signature) {
    console.log(section("Signature"));
    console.log(field("Value", r.signature));
  }

  console.log("");
}
