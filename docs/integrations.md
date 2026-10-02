# Integrations

Each integration here fixes a specific weakness in Assay. For each one this page gives the problem, why this tool fits better than the obvious alternative, what we built and where it lives, and its status.

## Status at a glance

| Integration | Used for | Where | Status |
|---|---|---|---|
| Monad P256 precompile | Host and passkey signatures checked onchain | `contracts/src/ReceiptAnchor.sol` | Live on testnet |
| ERC-8004 IdentityRegistry | Identity of hosts and verifiers | `contracts/src/`, `host/scripts/register-agent.ts` | Live on testnet, host is agent 1962 |
| Envio HyperIndex | Joined, derived read layer | `indexer/` | Built and tested, not yet deployed to Envio Cloud |
| Chainlink CRE | Decentralized re-check of grades | `contracts/src/CreAttestor.sol`, `cre/` | In progress |
| Mera passkey PRF | Receipt vault, per-app requester keys, per-receipt reveal keys | `web/src/mera.ts`, `ReceiptAnchor.cosignK` | Built, `cosignK` not yet deployed |
| Kimi | Trust agent that explains grades and receipts | not started | Planned |

## Monad: P256 precompile and ERC-8004

Problem. Assay needs two kinds of signature checked onchain. Hosts sign batch roots with P-256 keys, because cloud KMS, HSMs and TEEs sign P-256. Requesters co-sign with passkeys, which are P-256 WebAuthn credentials. In plain Solidity a P-256 check costs about 250,000 gas, too much to run on every batch. Assay also needs an identity for every host and verifier that it doesn't have to run itself.

Why this tool. Monad ships P256VERIFY at `0x0100` (EIP-7951), which checks a P-256 signature for 6,900 gas. OpenZeppelin 5.7.0's `P256` and `WebAuthn` libraries call it directly. ERC-8004 is deployed on Monad testnet as a shared registry, so a host's identity is an NFT anyone can look up, not an account in our database.

What we built.

| Piece | Where |
|---|---|
| `anchor()` verifies the host's ES256 signature over the batch through the precompile, 61,430 gas | `ReceiptAnchor.sol` |
| `cosign()` verifies a WebAuthn assertion with `requireUV = true`, 72,792 gas | `ReceiptAnchor.sol` |
| `setHostKey`, `registerVerifier` and `postGrade` check `ownerOf` on the IdentityRegistry | `ReceiptAnchor.sol`, `VerifierRegistry.sol` |
| Canary tests that fail if the precompile ever stops being used: `test_precompile_knownVector_returnsOne`, `test_valid_usesPrecompile_gasBound` | `contracts/test/` |
| Precompile check against the live testnet | [evidence/day1-precompile-testnet.txt](evidence/day1-precompile-testnet.txt) |
| Fork tests against the real ERC-8004 registry | `contracts/test/fork/`, [evidence/day3-erc8004-fork.txt](evidence/day3-erc8004-fork.txt) |
| Host registration script and agent card | `host/scripts/register-agent.ts`, `docs/agents/host.json` |

Status. Both contracts are live and verified on Monad testnet, and the first anchor is onchain. Addresses are in [deployments.md](deployments.md). The deployed `ReceiptAnchor` predates `cosignK` and needs a redeploy for it.

## Envio

Problem. Assay's data is spread over events from several contracts, and it only means something when joined. A grade needs the host's identity, an anchor needs the key that signed it, and a co-signature needs its batch. Answering "can I trust host X for model Y right now?" from raw RPC means scanning logs from the deploy block on every request.

Why this tool. HyperIndex gives typed handlers across several contracts in one config, reorg-safe storage and a GraphQL API. HyperSync backfills much faster than RPC, and Envio supports Monad testnet. A custom indexer would mean writing reorg handling ourselves.

What we built.

| Piece | Where |
|---|---|
| One config over ReceiptAnchor, VerifierRegistry, CreAttestor and the ERC-8004 IdentityRegistry | `indexer/config.yaml` |
| Derived entities written in handlers: `HostModelStats`, `DriftEvent`, `ModelLeaderboard`, `HostActivity`, `KeyRotation` | `indexer/src/handlers/` |
| Agent cards loaded from each agent's URI with the Effect API (`data:`, `https://`, `ipfs://`) | `indexer/src/agentCard.ts` |
| Chain-prefixed ids (`10143-…`), so a second chain is a config change | `indexer/schema.graphql` |
| Handler tests: drift fires exactly once, leaderboard order, rotation history, card fetch failures | `indexer/test/` |

Status. Codegen, type check and handler tests pass. Running against the chain needs Docker and an Envio API token, and the Envio Cloud deploy needs the repo owner. ReputationRegistry feedback is not indexed yet. Details and example queries are in [indexer/README.md](../indexer/README.md).

## Chainlink CRE

Problem. The verifier is Assay's weakest trust assumption. Today one verifier runs the harness on one machine and posts a grade. Readers can choose verifiers, but each grade still comes from a single party who could lie, pick a favourable run, or go offline.

Why this tool. A CRE workflow runs on a decentralized oracle network. Every node runs the same steps, the network reaches consensus on the result, and the forwarder writes it onchain. A multisig of our own servers would still be us. An optimistic dispute game would need challenge windows and a bond token.

What we built, and what is being built.

| Piece | Where | State |
|---|---|---|
| `CreAttestor`: accepts reports only from the configured forwarder and the pinned workflow owner and id, stores one attestation per grade, emits `GradeAttested` | `contracts/src/CreAttestor.sol` | Done, 21 tests |
| Workflow: `GradePosted` log trigger, fetch the evidence, check its sha256, recompute `passed`, `total` and the Wilson interval, reach consensus, write the report | `cre/` | In progress |
| Simulation output | `docs/evidence/` | In progress |
| Indexing of `GradeAttested` and the link to the re-checked grade | `indexer/src/handlers/CreAttestor.ts` | Done |

Status. In progress. `CreAttestor` is not deployed yet. The workflow is being built, and its simulation output will be saved in `docs/evidence/`.

## Mera

Problem. A requester has to keep the salt of every request. The salt is the only way to later prove that an output answered a prompt without publishing the prompt. Salts can't go to the host, a server or plain browser storage, because anyone holding a salt can brute-force short prompts. A second problem is linkability: if one passkey co-signs for every app, all of a person's AI activity is tied to one public key.

Why this tool. A passkey PRF output is deterministic key material. The same passkey, rpId and salt always give the same 32 bytes, on every synced device, with nothing stored. A password-derived key can be forgotten or phished. A cloud KMS means a platform holds your keys. A seed phrase turns the feature into a wallet.

What we built.

| Namespace | Primitive | Used for |
|---|---|---|
| `assay:vault:v1` | HKDF-SHA256, then AES-256-GCM | Encrypts saved receipts, salts and outputs. Only ciphertext is stored |
| `assay:requester:<appId>` | BIP-39 entropy, BIP-32 `m/44'/60'/0'/0/0`, secp256k1 | One co-signing identity per app, checked onchain by `cosignK` with `ecrecover` |
| `assay:reveal:<receiptHash>` | HKDF-SHA256, then AES-256-GCM | A key that opens one receipt's vault entry and nothing else |

Each namespace uses its own PRF salt, `sha256(label)`. Every ciphertext carries its label as AES-GCM associated data, so a blob sealed under one namespace won't open under another. The PRF output is used once and zeroed, and nothing derived from it is stored. The code is in `web/src/mera.ts` and `web/src/lib/vault.ts`. `cosignK` and its 10 tests are in `contracts/`.

Status. Built in the web app's Vault tab. `cosignK` is not deployed yet. Passkeys are bound to the rpId, so the live cross-device test runs once the app is on its final domain.

## Kimi

Problem. Grades are numbers: pass counts, intervals, drift events. A developer or an agent asking "should I send this request to host X?" needs a verdict with reasons, ideally in their own language.

Why this tool. Kimi is built for agentic tool use and is multilingual. Moonshot already runs a vendor verifier for hosts of its own models, so Kimi comes from a provider that cares about this exact problem.

What we plan to build. A trust agent with three tools over Assay's own infrastructure: `get_grade` (Envio GraphQL), `verify_receipt` (SDK `verifyReceipt`) and `get_host_card` (the ERC-8004 agent card). It takes a receipt or a host name and returns a verdict with evidence links. Its answers would be served through an Assay host, so each one carries its own receipt. Separately, the grader can cover Kimi K3's OpenRouter endpoints against Moonshot's own API.

Status. Planned, not started. It needs a small Moonshot API top-up.
