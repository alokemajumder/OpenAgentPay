/**
 * @module commands/discover
 *
 * The `agentpay discover <url>` command.
 *
 * Fetches `<url>/.well-known/agent-pay` and pretty-prints the
 * service discovery document.
 *
 * @packageDocumentation
 */

import {
  section,
  field,
  table,
  highlightJson,
  color,
  yellow,
  green,
  gray,
  dim,
  b,
  reset,
} from "../formatter.js";

/**
 * Shape of the .well-known/agent-pay discovery document.
 * Kept flexible since this is an evolving spec.
 */
interface DiscoveryDocument {
  name?: string;
  description?: string;
  version?: string;
  methods?: string[];
  currencies?: string[];
  endpoints?: Array<{
    path: string;
    pricing?: {
      amount: string;
      currency: string;
      unit: string;
    };
    description?: string;
  }>;
  capabilities?: Record<string, unknown>;
  contact?: string;
  docs_url?: string;
  tos_url?: string;
  [key: string]: unknown;
}

/**
 * Execute the discover command.
 *
 * @param url - Base URL of the service to discover.
 */
export async function discover(url: string): Promise<void> {
  // Normalize the URL — strip trailing slash
  const base = url.replace(/\/+$/, "");
  const discoveryUrl = `${base}/.well-known/agent-pay`;

  console.log(`\n${b("Discovering")} ${color(discoveryUrl, yellow)}...\n`);

  let response: Response;
  try {
    response = await fetch(discoveryUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    console.error(color("  Error: Could not connect.", "\x1b[31"));
    console.error(`  ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  if (!response.ok) {
    console.error(
      color(`  Error: Server returned ${response.status} ${response.statusText}`, "\x1b[31"),
    );
    if (response.status === 404) {
      console.log(
        `\n  ${dim}This service does not publish a .well-known/agent-pay document.${reset}\n`,
      );
    }
    process.exit(1);
  }

  let doc: DiscoveryDocument;
  try {
    doc = (await response.json()) as DiscoveryDocument;
  } catch {
    console.error(color("  Error: Response is not valid JSON.", "\x1b[31"));
    process.exit(1);
  }

  // Service info
  console.log(section("Service"));
  console.log(
    table([
      ["Name", doc.name],
      ["Description", doc.description],
      ["Version", doc.version],
      ["Contact", doc.contact],
      ["Docs", doc.docs_url],
      ["ToS", doc.tos_url],
    ]),
  );

  // Payment methods
  if (doc.methods && doc.methods.length > 0) {
    console.log(section("Payment Methods"));
    for (const method of doc.methods) {
      console.log(`  ${color("●", green)} ${method}`);
    }
  }

  // Currencies
  if (doc.currencies && doc.currencies.length > 0) {
    console.log(section("Currencies"));
    console.log(`  ${doc.currencies.join(", ")}`);
  }

  // Endpoints
  if (doc.endpoints && doc.endpoints.length > 0) {
    console.log(section("Endpoints"));
    for (const ep of doc.endpoints) {
      console.log(`\n  ${b(ep.path)}`);
      if (ep.description) {
        console.log(field("Description", ep.description));
      }
      if (ep.pricing) {
        console.log(
          field(
            "Pricing",
            `${ep.pricing.amount} ${ep.pricing.currency} ${ep.pricing.unit}`,
          ),
        );
      }
    }
  }

  // Capabilities
  if (doc.capabilities && Object.keys(doc.capabilities).length > 0) {
    console.log(section("Capabilities"));
    console.log(highlightJson(doc.capabilities));
  }

  // Any other fields not already printed
  const knownKeys = new Set([
    "name", "description", "version", "methods", "currencies",
    "endpoints", "capabilities", "contact", "docs_url", "tos_url",
  ]);
  const extraKeys = Object.keys(doc).filter((k) => !knownKeys.has(k));
  if (extraKeys.length > 0) {
    console.log(section("Additional Fields"));
    const extra: Record<string, unknown> = {};
    for (const k of extraKeys) {
      extra[k] = doc[k];
    }
    console.log(highlightJson(extra));
  }

  console.log("");
}
