# @openagentpay/cli

CLI tool for testing 402 payment flows, probing endpoints, inspecting receipts, and simulating agent payments.

## Install

```bash
npm install -g @openagentpay/cli
```

## Usage

```bash
agentpay probe https://api.example.com/data     # Check pricing
agentpay discover https://api.example.com        # Service discovery
agentpay simulate https://api.example.com --count 100  # Load test
agentpay receipt ./receipt.json                  # Inspect receipt
```

See the [main documentation](../../README.md) for full details.
