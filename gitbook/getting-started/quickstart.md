---
description: Go from a clean clone to a receipt that passes every offline check, then read a real anchor from Monad testnet.
icon: rocket
---

# Quickstart

**Where:** `@assay/receipts` (the SDK in `sdk/`), run from the `host/` package, plus one `cast call` to `ReceiptAnchor` on Monad testnet.

You build a receipt, sign it with a throwaway host key, batch it, and run `verifyReceipt` on it. No API key, wallet or MON is needed. The last step reads the first anchor Assay put on testnet.

## What you need

| Tool | Version | Why |
|---|---|---|
| Node | 22 or newer | SDK, host and indexer |
| pnpm | 10.20.0, through `corepack enable` | The workspace pins it |
| Foundry | 1.7 or newer | Contract tests and `cast` |
| Git | any | Submodules for forge-std and OpenZeppelin 5.7.0 |

## Steps

1. Clone with submodules and install.

```bash
git clone --recurse-submodules https://github.com/trudransh/Assay.git
cd Assay
corepack enable
pnpm install
```

2. Run the SDK and contract tests. The Solidity tests read vectors the SDK generates, so both sides must pass.

```bash
pnpm --filter @assay/receipts test
cd contracts && forge test && cd ..
```

3. Save this file as `host/quickstart.ts`. The `host` package already depends on `@assay/receipts` and `jose`.

```typescript
import { exportJWK, generateKeyPair } from "jose";
import {
  buildBatch,
  buildReceipt,
  commitRequest,
  commitResponse,
  createHostSigner,
  newSalt,
  receiptHash,
  verifyReceipt,
} from "@assay/receipts";

// A throwaway host key. A real host loads its key from host/.keys/host.jwk.json.
const { privateKey } = await generateKeyPair("ES256", { extractable: true });
const signer = await createHostSigner(await exportJWK(privateKey), "demo-key");

const salt = newSalt();
const messages = [{ role: "user", content: "Say OK" }];
const params = { temperature: 0, max_tokens: 16 };
const output = "OK";

const body = buildReceipt({
  model: "z-ai/glm-5.3",
  host: { agentId: "erc8004:10143:1962", keyId: signer.kid, alg: "ES256" },
  req: { commit: commitRequest(salt, messages, params), params },
  res: { commit: commitResponse(salt, output), tokensIn: 9, tokensOut: 1, finish: "stop" },
});
const jws = await signer.signReceipt(body);
const hash = receiptHash(body);
const batch = buildBatch([hash]);

const result = await verifyReceipt({
  body,
  jws,
  jwks: { keys: [signer.publicJwk] },
  proof: batch.proofs.get(hash),
  root: batch.root,
  salt,
  output,
  messages,
  params,
});
console.log(result.ok, result.checks);
```

4. Run it.

```bash
pnpm --filter @assay/host exec tsx quickstart.ts
```

You should see:

```
true {
  jws: 'pass',
  hash: 'pass',
  kid: 'pass',
  merkle: 'pass',
  anchored: 'skipped',
  outputCommit: 'pass',
  promptCommit: 'pass',
  cosigned: 'skipped'
}
```

5. Read the first real anchor. Agent 1962 anchored a 2-receipt batch on 1 Oct 2026.

```bash
cast call 0x049A73755cA3508ef3Daa4752A3406f6e00CfB13 \
  "anchors(uint256,bytes32)(uint32,uint64)" 1962 \
  0x5594c31b47c59350e82e11a4161b629c03ac85a36c02dc74c2630fde01086e57 \
  --rpc-url https://testnet-rpc.monad.xyz
```

The output is `2` (receipts in the batch) and `1790862482` (the anchor time in Unix seconds).

## What each result means

| Check | `pass` means | Why it was `skipped` here |
|---|---|---|
| `jws` | The signature verifies against the JWKS you passed. | |
| `hash` | The body you hold is byte for byte the body the host signed. | |
| `kid` | The JWS `kid` equals `host.keyId` in the body. | |
| `merkle` | The proof puts the receipt under `root`. | |
| `anchored` | `root` is anchored onchain under the body's agent id. | No `onchain` client was passed, and this demo root was never anchored. |
| `outputCommit` | `salt` and `output` reproduce `res.commit`. | |
| `promptCommit` | `salt`, `messages` and `params` reproduce `req.commit`. | |
| `cosigned` | The key named in `req.cosigner` co-signed onchain. | The body has no `req.cosigner`. |

## Where else this shows up

| Place | What it does with the same receipt |
|---|---|
| [SDK reference](../developers/sdk.md) | Every function used above, with its inputs and errors. |
| [Host API](../developers/host-api.md) | `POST /v1/chat/completions` builds this exact body for a real model. |
| [Contracts reference](../developers/contracts.md) | `anchors` and `verifyReceipt` on `ReceiptAnchor`. |
| [Network and contracts](network-and-contracts.md) | The addresses used in step 5. |

{% hint style="warning" %}
`skipped` is not a failure, and `result.ok` stays `true` when checks are skipped. If your app needs a check, require `result.checks.<name> === "pass"` yourself instead of reading `ok` alone.
{% endhint %}

Next: [Core concepts](core-concepts.md)
