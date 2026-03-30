/**
 * @openagentpay/cli
 *
 * CLI tool for testing 402 payment flows, inspecting receipts,
 * and simulating agent payments — like "Postman for agent payments".
 *
 * This module re-exports the command implementations for programmatic use.
 *
 * @packageDocumentation
 */

export { probe } from "./commands/probe.js";
export { discover } from "./commands/discover.js";
export { receipt } from "./commands/receipt.js";
export { pay } from "./commands/pay.js";
export { simulate } from "./commands/simulate.js";
