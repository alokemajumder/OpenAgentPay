# @openagentpay/vault

Credential vault with encrypted storage and agent identity management. Supports DIDs, Ed25519 attestations, and KYA (Know Your Agent) compliance profiles.

## Install

```bash
npm install @openagentpay/vault
```

## Usage

```typescript
import { AgentIdentityManager } from '@openagentpay/vault';

const identity = new AgentIdentityManager({ privateKey: '0x...', label: 'my-agent' });
const did = identity.getDID(); // did:key:z6Mk...
const attestation = identity.createAttestation(did, 'payment-authorization', { maxSpend: '100' });
```

See the [main documentation](../../README.md) for full details.
