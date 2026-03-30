# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-03-29

### Added
- **adapter-solana**: SPL token payments on Solana with Ed25519 signing
- **adapter-lightning**: Lightning Network BOLT11 invoice payments via LND REST
- **proxy**: Zero-code reverse proxy with 402 payment gating
- **mcp-mpp**: MCP-to-MPP bridge for paid tool discovery and payment
- **cli**: `agentpay` CLI tool (probe, pay, discover, simulate, receipt)
- **server-cloudflare**: Cloudflare Workers paywall middleware + KV receipt store
- **tax**: Tax calculator and reporter (US/EU/India/Japan/Singapore)
- **razorpay-mcp**: Razorpay MCP server client with 48+ payment tools
- MPP streaming payments and IETF `Payment` auth scheme support
- MPP session-first wallet mode for automatic session management
- UPI Reserve Pay (SBMD) — NPCI's budget-envelope model for agentic payments
- UPI QR code generation, refund support, webhook signature verification
- Service discovery via `/.well-known/agent-pay` endpoint (Express + Hono)
- Agent identity/DID support with Ed25519 attestations and KYA profiles
- Identity-required policy rule for agent compliance
- Solana and Lightning payment method types in core
- GitHub Actions CI/CD pipeline (lint, typecheck, test, build)

### Changed
- **adapter-x402**: Replaced HMAC-SHA256 testnet signing with production secp256k1 ECDSA + keccak-256
- **adapter-mpp**: Added `WWW-Authenticate: Payment` header support per IETF draft
- **policy**: Extended to 12 rules (added identity_required)
- Updated README with all 26 packages, 10 adapters, deployment options

### Fixed
- MPP challenge store cleanup now uses shared helper to prevent code duplication

## [0.1.0] - 2026-03-15

### Added
- Initial release with 18 packages
- Core types, schemas, builders, parsers
- Payment adapters: x402, MPP, Stripe, PayPal, UPI, Visa, Credits, Mock
- Server middleware: Express, Hono
- Client SDK with policy engine (11 rules)
- Smart Router with 14 routing strategies
- Receipt storage and export (memory, file, CSV, JSON)
- MCP tool monetization (`paidTool()`)
- Credential vault with encrypted storage
- OpenTelemetry exporter
- Subscription support
