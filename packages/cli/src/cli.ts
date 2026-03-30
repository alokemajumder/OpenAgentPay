#!/usr/bin/env node

/**
 * @module cli
 *
 * Main CLI entry point for agentpay — a tool for testing 402
 * payment flows, inspecting receipts, and simulating agent payments.
 *
 * @packageDocumentation
 */

import { probe } from "./commands/probe.js";
import { discover } from "./commands/discover.js";
import { receipt } from "./commands/receipt.js";
import { pay } from "./commands/pay.js";
import { simulate } from "./commands/simulate.js";
import { b, color, cyan, dim, yellow, reset, green } from "./formatter.js";

// ---------------------------------------------------------------------------
// Argument Parsing
// ---------------------------------------------------------------------------

/**
 * Extract the value of a named flag from argv.
 * Supports `--flag value` and `--flag=value` syntax.
 */
function getFlag(args: string[], name: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === `--${name}` && i + 1 < args.length) {
      return args[i + 1];
    }
    if (arg.startsWith(`--${name}=`)) {
      return arg.slice(`--${name}=`.length);
    }
  }
  return undefined;
}

/**
 * Check if a boolean flag is present.
 */
function hasFlag(args: string[], name: string): boolean {
  return args.some((a) => a === `--${name}`);
}

// ---------------------------------------------------------------------------
// Help Text
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`
${b("agentpay")} — Postman for agent payments

${b("USAGE")}
  agentpay <command> [options]

${b("COMMANDS")}
  ${color("probe", green)} <url>                          Probe a URL for 402 Payment Required
  ${color("pay", green)} <url> --method <type> [--wallet <key>]  Make a paid request
  ${color("receipt", green)} <file|json>                    Parse and display a receipt
  ${color("discover", green)} <url>                        Fetch .well-known/agent-pay discovery
  ${color("simulate", green)} <url> --count <n> --method <type>  Simulate N requests with stats
  ${color("help", green)}                                  Show this help message

${b("EXAMPLES")}
  ${dim}# Probe an API for payment requirements${reset}
  agentpay probe https://api.example.com/search

  ${dim}# Discover service capabilities${reset}
  agentpay discover https://api.example.com

  ${dim}# Attempt payment with a specific method${reset}
  agentpay pay https://api.example.com/search --method x402 --wallet 0xabc...

  ${dim}# Parse a receipt file${reset}
  agentpay receipt ./receipt.json

  ${dim}# Simulate 100 requests and view stats${reset}
  agentpay simulate https://api.example.com/search --count 100 --method x402

${b("VERSION")}
  0.1.0
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "help" || hasFlag(args, "help")) {
    printHelp();
    return;
  }

  switch (command) {
    case "probe": {
      const url = args[1];
      if (!url) {
        console.error(`${color("Error:", "\x1b[31")} Missing URL argument.\n`);
        console.error("  Usage: agentpay probe <url>");
        process.exit(1);
      }
      await probe(url);
      break;
    }

    case "pay": {
      const url = args[1];
      if (!url) {
        console.error(`${color("Error:", "\x1b[31")} Missing URL argument.\n`);
        console.error("  Usage: agentpay pay <url> --method <type> [--wallet <key>]");
        process.exit(1);
      }
      const method = getFlag(args, "method");
      if (!method) {
        console.error(`${color("Error:", "\x1b[31")} Missing --method flag.\n`);
        console.error("  Usage: agentpay pay <url> --method <type> [--wallet <key>]");
        process.exit(1);
      }
      const wallet = getFlag(args, "wallet");
      await pay(url, method, wallet);
      break;
    }

    case "receipt": {
      const input = args[1];
      if (!input) {
        console.error(`${color("Error:", "\x1b[31")} Missing file path or JSON argument.\n`);
        console.error("  Usage: agentpay receipt <file|json>");
        process.exit(1);
      }
      await receipt(input);
      break;
    }

    case "discover": {
      const url = args[1];
      if (!url) {
        console.error(`${color("Error:", "\x1b[31")} Missing URL argument.\n`);
        console.error("  Usage: agentpay discover <url>");
        process.exit(1);
      }
      await discover(url);
      break;
    }

    case "simulate": {
      const url = args[1];
      if (!url) {
        console.error(`${color("Error:", "\x1b[31")} Missing URL argument.\n`);
        console.error("  Usage: agentpay simulate <url> --count <n> --method <type>");
        process.exit(1);
      }
      const countStr = getFlag(args, "count");
      if (!countStr) {
        console.error(`${color("Error:", "\x1b[31")} Missing --count flag.\n`);
        console.error("  Usage: agentpay simulate <url> --count <n> --method <type>");
        process.exit(1);
      }
      const count = parseInt(countStr, 10);
      if (isNaN(count) || count < 1) {
        console.error(`${color("Error:", "\x1b[31")} --count must be a positive integer.\n`);
        process.exit(1);
      }
      const method = getFlag(args, "method");
      if (!method) {
        console.error(`${color("Error:", "\x1b[31")} Missing --method flag.\n`);
        console.error("  Usage: agentpay simulate <url> --count <n> --method <type>");
        process.exit(1);
      }
      await simulate(url, count, method);
      break;
    }

    default:
      console.error(`${color("Error:", "\x1b[31")} Unknown command "${command}".\n`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n${color("Fatal error:", "\x1b[31")} ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
