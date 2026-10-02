---
description: Every attack found in Assay's design, what stops it, and the test that proves it.
icon: shield-halved
---

# Threat model

**Where:** the tests in `contracts/test/` (Foundry), `sdk/test/` (vitest) and `host/test/`. Run `forge test` and `pnpm -r test` to reproduce every row.

Each row names an attack, the defence, and the test that fails if the defence is removed. Contract guards were mutation checked: delete the check, watch the test fail, restore it.

## Anchoring

| Attack | Defence | Test |
|---|---|---|
| Another host copies a pending root from the mempool and anchors it first, blocking the real host | Anchors are keyed per host: `anchors[agentId][root]` | `test_anchor_otherHostSameRoot_doesNotBlock` |
| A receipt is "verified" against another host's anchor | `verifyReceipt` takes `agentId` | `test_verifyReceipt_otherHostsAnchor_false` |
| Replay of the same anchor | `RootAlreadyAnchored` | `test_anchor_replay_reverts` |
| Replay of a signature on another chain or deployment | Chain id and contract address are in the signed message | `test_anchor_otherDeployment_reverts` |
| A relayer changes `count` | `count` is in the signed message | `test_anchor_countTampered_reverts` |
| A forged or wrong-key signature | P-256 check against the registered key | `test_anchor_wrongKey_reverts` |
| A high-`s` duplicate signature | OpenZeppelin `P256` rejects high `s` | `test_anchor_highS_reverts` |
| Anchoring for a host with no key, or an empty batch | `UnknownHost`, `EmptyBatch` | `test_anchor_unknownHost_reverts`, `test_anchor_emptyBatch_reverts` |
| Someone sets a key for an agent they don't own | `ownerOf` check | `test_setHostKey_nonOwner_reverts` |
| An invalid curve point as a host key | `P256.isValidPublicKey` | `test_setHostKey_invalidPoint_reverts` |
| Key rotation wipes old anchors | Anchors stay under the agent id | `test_setHostKey_rotation_keepsOldAnchors` |
| A mutated Merkle proof | `MerkleProof` against a double-hashed leaf | `testFuzz_mutatedProofFails`, `test_verifyReceipt_badProof_false` |

## Co-signatures

| Attack | Defence | Test |
|---|---|---|
| Someone who saw the receipt hash co-signs first with their own passkey, blocking the requester | One record per key, and `req.cosigner` in the signed body names the real requester | `test_cosign_otherKeyFirst_doesNotBlock`, `test_cosignK_otherSignerFirst_doesNotBlock` |
| Co-signing a receipt that was never anchored | `ReceiptNotAnchored` | `test_cosign_notAnchored_reverts`, `test_cosignK_notAnchored_reverts` |
| Reusing a signature over another receipt | The challenge must equal `receiptHash` | `test_cosign_challengeIsOtherReceipt_reverts`, `test_cosignK_signatureOverOtherHash_cannotClaimSigner` |
| Proof against another host's agent id | Per-host anchors | `test_cosign_otherHostsAgentId_reverts`, `test_cosignK_otherHostsAgentId_reverts` |
| An assertion without user presence or verification | `requireUV = true` | `test_cosign_missingUP_reverts`, `test_cosign_missingUV_reverts` |
| Malleable signatures | High `s` rejected, 65-byte length and valid `v` required | `test_cosign_highS_reverts`, `test_cosignK_highS_reverts`, `test_cosignK_badLength_reverts`, `test_cosignK_badV_reverts` |
| Double co-sign by the same key | `AlreadyCosigned` | `test_cosign_replay_reverts`, `test_cosignK_replay_reverts` |
| A passkey from another site | The contract skips origin and rpIdHash, so the SDK and web app check them offchain | `checkOrigin`, `checkRpIdHash` in the SDK tests |

## Grades

| Attack | Defence | Test |
|---|---|---|
| Fake verifiers flood the registry | Readers pass their own `trusted` list to `gradeOf` | `test_gradeOf_ignoresUntrusted` |
| A verifier sells its identity and keeps posting | `ownerOf` is re-checked on every post | `test_post_afterIdentityTransferred_reverts` |
| A verifier rolls back its own record | `t` must be newer than the stored grade | `test_post_staleGrade_reverts` |
| Impossible counts or intervals | `BadCounts`, `BadInterval` | `test_post_passedGtTotal_reverts`, `test_post_ciInverted_reverts`, `test_post_ciOver10000_reverts` |
| A grade dated in the future | `FutureTimestamp` | `test_post_futureTimestamp_reverts` |
| A host rotates its key to shed a bad grade | Grades are keyed by identity, `keccak256("erc8004:<chainId>:<agentId>")` | SDK `hostKeyForAgent` vectors, harness export tests |
| Another CRE workflow writes attestations | Reports pinned to forwarder, workflow owner and id | `test_onReport_nonForwarder_reverts`, `test_onReport_wrongWorkflowOwner_reverts`, `test_onReport_wrongWorkflowId_reverts` |

## Host and receipts

| Attack | Defence | Where |
|---|---|---|
| Brute-forcing a short prompt from its commit | A fresh 32-byte salt per request | `X-Assay-Salt` is required, 400 without it |
| OpenRouter silently falls back to another provider | `allow_fallbacks: false`, and a mismatch returns 502 with no receipt | Host tests |
| A receipt edited after signing | `hash` check against the signed JWS payload | SDK test: one corrupted input fails exactly one check |
| Old receipts stop verifying after a key rotation | Retired keys stay in the JWKS with `"status": "retired"` | Host JWKS test |
| The co-sign relay is used to drain the relayer | 10 per IP per hour, only receipts this host issued | Host rate-limit test |
| Silent fallback from the P256 precompile to Solidity | `evm_version = "osaka"` pinned | `test_precompile_knownVector_returnsOne`, `test_valid_usesPrecompile_gasBound` |

## Known limits

| Limit | Why |
|---|---|
| A receipt doesn't prove which weights ran | That needs a host signing inside a TEE whose quote includes a model hash |
| The v0 host key is a local file | No KMS or HSM yet |
| A host can re-register a new identity to escape its history | Readers should weigh identity age and grade count |
| Receipts are not bearer tickets | A contract that pays on a receipt must store `receiptHash` as spent |

## Where else this shows up

| Place | What it covers |
|---|---|
| [Design decisions](decisions.md) | Why each defence was chosen |
| [Contracts reference](../developers/contracts.md) | Every revert reason |

{% hint style="warning" %}
The contract records every valid co-signature. A verifier that shows "co-signed" without checking `req.cosigner` will credit whoever signed first, which is exactly the attack the per-key design exists to stop.
{% endhint %}

Next: [Design decisions](decisions.md)
