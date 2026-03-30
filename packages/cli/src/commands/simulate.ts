/**
 * @module commands/simulate
 *
 * The `agentpay simulate <url> --count <n> --method <type>` command.
 *
 * Runs N sequential probes to a URL and reports statistics:
 * average response time, success rate, and pricing info.
 *
 * @packageDocumentation
 */

import {
  parsePaymentRequired,
  type PaymentRequired,
} from "@openagentpay/core";
import {
  section,
  table,
  color,
  yellow,
  green,
  red,
  gray,
  dim,
  b,
  reset,
  statusBadge,
  field,
} from "../formatter.js";

interface ProbeResult {
  status: number;
  latencyMs: number;
  parsed: PaymentRequired | null;
  error: string | null;
}

/**
 * Execute the simulate command.
 *
 * @param url - The URL to simulate requests against.
 * @param count - Number of sequential probes to run.
 * @param methodType - Payment method type to look for in 402 responses.
 */
export async function simulate(
  url: string,
  count: number,
  methodType: string,
): Promise<void> {
  console.log(`\n${b("Simulating")} ${color(String(count), yellow)} requests to ${color(url, yellow)}`);
  console.log(field("Method filter", methodType));
  console.log("");

  const results: ProbeResult[] = [];

  for (let i = 0; i < count; i++) {
    const label = `  [${String(i + 1).padStart(String(count).length)}/${count}]`;
    const start = performance.now();

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      const latencyMs = Math.round(performance.now() - start);
      let parsed: PaymentRequired | null = null;

      if (response.status === 402) {
        try {
          const body = await response.json();
          parsed = parsePaymentRequired(body);
        } catch {
          // Body parse failed — still count as a valid HTTP response
        }
      }

      results.push({ status: response.status, latencyMs, parsed, error: null });

      const badge = statusBadge(response.status);
      console.log(`${label} ${badge} ${dim}${latencyMs}ms${reset}`);
    } catch (err) {
      const latencyMs = Math.round(performance.now() - start);
      const message = err instanceof Error ? err.message : String(err);
      results.push({ status: 0, latencyMs, parsed: null, error: message });
      console.log(`${label} ${color("ERR", red)} ${dim}${latencyMs}ms${reset} ${color(message, gray)}`);
    }
  }

  // Compute statistics
  const totalRequests = results.length;
  const successfulRequests = results.filter((r) => r.status > 0).length;
  const failedRequests = results.filter((r) => r.status === 0).length;
  const fourOhTwoRequests = results.filter((r) => r.status === 402).length;

  const latencies = results.filter((r) => r.status > 0).map((r) => r.latencyMs);
  const avgLatency = latencies.length > 0
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : 0;
  const minLatency = latencies.length > 0 ? Math.min(...latencies) : 0;
  const maxLatency = latencies.length > 0 ? Math.max(...latencies) : 0;
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);

  const successRate = totalRequests > 0
    ? ((successfulRequests / totalRequests) * 100).toFixed(1)
    : "0.0";

  console.log(section("Results"));
  console.log(
    table([
      ["Total Requests", String(totalRequests)],
      ["Successful", color(String(successfulRequests), green)],
      ["Failed", failedRequests > 0 ? color(String(failedRequests), red) : String(failedRequests)],
      ["402 Responses", color(String(fourOhTwoRequests), yellow)],
      ["Success Rate", `${successRate}%`],
    ]),
  );

  console.log(section("Latency"));
  console.log(
    table([
      ["Average", `${avgLatency}ms`],
      ["Min", `${minLatency}ms`],
      ["Max", `${maxLatency}ms`],
      ["P50", `${p50}ms`],
      ["P95", `${p95}ms`],
    ]),
  );

  // Pricing info from parsed 402 responses
  const parsedResults = results.filter((r) => r.parsed !== null);
  if (parsedResults.length > 0) {
    const first = parsedResults[0].parsed!;
    const methodAvailable = first.methods.some(
      (m) => m.type.toLowerCase() === methodType.toLowerCase(),
    );

    console.log(section("Pricing Info"));
    console.log(
      table([
        ["Amount", first.pricing.amount],
        ["Currency", first.pricing.currency],
        ["Unit", first.pricing.unit],
        ["Method Available", methodAvailable ? color("Yes", green) : color("No", red)],
        [
          "Est. Cost (all)",
          `${(parseFloat(first.pricing.amount) * fourOhTwoRequests).toFixed(6)} ${first.pricing.currency}`,
        ],
      ]),
    );

    if (first.methods.length > 0) {
      console.log(section("Available Methods"));
      for (const m of first.methods) {
        const marker = m.type.toLowerCase() === methodType.toLowerCase()
          ? color("*", green)
          : " ";
        console.log(`  ${marker} ${m.type}`);
      }
    }
  }

  console.log("");
}

/**
 * Compute a percentile from an array of numbers.
 */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}
