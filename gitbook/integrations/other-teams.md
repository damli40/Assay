---
description: Two Monad Metropolis teams Assay works with, what each integration does, and what it doesn't claim.
icon: handshake
---

# MonadGuard and Mandate

An agent has three questions to answer before it acts. Is the tool it's about to call safe to connect to? How much is it allowed to spend? Which model host is answering? MonadGuard, Mandate and Assay each answer one of them, and they compose without merging their trust models.

## MonadGuard: checks the tool

[MonadGuard](https://github.com/poteshniy/monadguard) attests a static artifact: the manifest an MCP server declares, pinned to its content hash. Assay attests a runtime event: which host served which bytes and what it claimed. *MonadGuard checks the tool, Assay checks the model host that answered.*

**Same receipt format, verified both ways.** Both projects sign receipts as an ES256 compact JWS whose payload is the JCS bytes of the receipt, with keys at `/.well-known/jwks.json` and `receiptHash = sha256(payload)`.

| Date | Who checked | What | Result |
|---|---|---|---|
| 3 Oct 2026 | Assay's verifier | 3 MonadGuard receipts on Monad mainnet | All pass |
| 4 Oct 2026 | MonadGuard's `scripts/verify-foreign.mjs` (`bbacb8b`) | Assay receipt `0x9a166cac…07e5` | 10 of 10 checks, including a byte-for-byte JCS match |

Each side pins the other's receipts as offline test fixtures, so CI never depends on the other's server. Assay's are in [`docs/interop/`](https://github.com/trudransh/Assay/tree/main/docs/interop) and `sdk/test/interop.test.ts`.

**The anchoring models differ.** MonadGuard verifies every record's signature as it's written. Assay verifies one host signature per batch when the batch is anchored, and each receipt when someone reads it. See [Anchoring](../how-it-works/anchoring.md).

**A joint check stays thin.** An agent calls MonadGuard's `gate(tool)` before connecting to an MCP server and Assay's grade gate before sending to a host, and refuses if either throws. There's no shared library and no cross-vouching. A CLEAN verdict doesn't mean the code behind the interface is safe, and a receipt doesn't prove which weights ran.

## Mandate: limits the spend

[Mandate](https://github.com/aliveevie/mandate) lets a person give an agent a scoped, revocable spending mandate from a passkey. A mandate bounds how much an agent spends. [Pull request #12](https://github.com/aliveevie/mandate/pull/12) adds an opt-in `@ibxlab/mandate/assay` entry point that bounds *who the inference money goes to*.

```ts
import { createInferenceGuard, guardAgent } from "@ibxlab/mandate/assay";

const guard = createInferenceGuard({ publicClient, model: "z-ai/glm-5.3", host: "openrouter:deepinfra/fp8", verifiers: [trustedVerifier] });
const agent = guardAgent(client.agent.load({ mandateHash, executor }), guard);
await agent.execute({ target: inferenceVenue, data, amount }); // InferenceHostRefused before anything is sent
```

It's one view call to Assay's `gradeOf`, it fails closed, and it adds no dependencies. Its host-key vectors are pinned to the same values as Assay's SDK and grader.

Next: [Threat model](../security/threat-model.md)
