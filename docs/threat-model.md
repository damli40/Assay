# Threat model

This page lists every attack we found against Assay, how the design stops it, and the test that proves the defence. Test names are exact, so you can run any of them on its own:

```bash
cd contracts && forge test --match-test test_anchor_otherHostSameRoot_doesNotBlock -vv
corepack pnpm --filter @assay/receipts test -- verify
corepack pnpm --filter @assay/host test -- server
```

## Who can attack

| Actor | Can do |
|---|---|
| Another host | Register its own ERC-8004 identity and key, watch the mempool, anchor any root it signs |
| Anyone watching the chain | Read every receipt hash, root and proof that goes onchain, and send transactions first |
| A dishonest host | Sign whatever it likes with its own key, serve a different model, rotate keys |
| A dishonest verifier | Post grades, sell its identity, try to rewrite its own history |
| Anyone on the CRE network | Run their own workflow through the shared CRE forwarder |
| A consumer contract | Accept receipts as proof for payments or credits |

## Attacks and defences

### Anchoring

| Attack | Defence | Test |
|---|---|---|
| Front-run an anchor. Another host copies a pending root from the mempool, signs it with its own key and anchors it first, so the honest host reverts and the record credits the attacker. | Anchors are keyed per host, `anchors[agentId][root]`. `verifyReceipt` takes `agentId`, so a root anchored by another host proves nothing about this one. | `test_anchor_otherHostSameRoot_doesNotBlock`, `test_verifyReceipt_otherHostsAnchor_false` |
| Replay an anchor. Resend the same signed anchor. | A root can be anchored once per host. | `test_anchor_replay_reverts` |
| Cross-deployment replay. Take a valid anchor signature to another `ReceiptAnchor`. | The signed message includes `address(this)`. | `test_anchor_otherDeployment_reverts` |
| Cross-chain replay. Take a valid anchor signature to another chain. | The signed message includes `block.chainid`. There is no separate test with two chain ids. The message layout is pinned byte for byte against the SDK. | `test_anchorMessage_matchesNode`, SDK `anchorMessage matches the bytes the Solidity fixture checks` |
| Count tampering. Relay a real signature with a different `count`. | `count` is inside the signed message. | `test_anchor_countTampered_reverts` |
| Empty batch spam. | `count == 0` reverts with `EmptyBatch`. The host never anchors an empty queue. | `test_anchor_emptyBatch_reverts`, host `never anchors an empty queue` |
| Anchor for a host with no key, or with the wrong key. | `UnknownHost` and `BadHostSignature`. | `test_anchor_unknownHost_reverts`, `test_anchor_wrongKey_reverts` |
| Forge a Merkle proof. | OpenZeppelin `MerkleProof` with double-hashed leaves, so a leaf can't pass as an inner node. Fuzzed with 1,000 runs. | `testFuzz_mutatedProofFails`, `test_verifyReceipt_badProof_false`, `test_verifyReceipt_wrongLeaf_false` |

### Signatures and keys

| Attack | Defence | Test |
|---|---|---|
| High-s malleability. Flip `s` to `N - s` to get a second valid signature. | OpenZeppelin `P256` rejects high `s`. The SDK normalizes `s` before anything goes onchain. `cosignK` uses `tryRecover`, which rejects high `s` too. | `test_highS_acceptedByPrecompile_rejectedByOZ`, `test_anchor_highS_reverts`, `test_cosign_highS_reverts`, `test_cosignK_highS_reverts`, SDK `flips high s, leaves low s, and both still verify` |
| Invalid curve point. Register a key that isn't on P-256, or `(0, 0)`. | `setHostKey` calls `P256.isValidPublicKey`. The SDK rejects non-P-256 and compressed keys. | `test_setHostKey_invalidPoint_reverts`, SDK `rejects non-P-256 SPKI and compressed points` |
| Set another host's key. | `setHostKey` requires the caller to own the ERC-8004 identity. | `test_setHostKey_nonOwner_reverts` |
| Key rotation breaks old receipts. | Old anchors stay valid after `setHostKey`. The host keeps retired keys in its JWKS marked `"status": "retired"`, so old JWS signatures still verify. | `test_setHostKey_rotation_keepsOldAnchors`, host `publishes retired keys, marked, so receipts signed before a rotation still verify (D22)` |
| Swap a key under the same `kid`. | The JWS check uses the published key, and a different key under the same `kid` fails. | SDK `fails when a different key is published under the same kid` |
| `alg: none` or a non-canonical payload. | Only ES256 is accepted, and the payload must be the JCS form of the body. | SDK `rejects alg "none"`, `rejects a validly signed payload that isn't canonical JSON` |

### Co-signatures

| Attack | Defence | Test |
|---|---|---|
| Front-run a co-sign. Someone who sees the receipt hash co-signs first with their own passkey, to block the requester or claim to be the one who asked. | One record per key, `cosigned[receiptHash][requesterKey]` and `cosignedK[receiptHash][signer]`. A first co-sign by another key doesn't block anyone. | `test_cosign_otherKeyFirst_doesNotBlock`, `test_cosignK_otherSignerFirst_doesNotBlock` |
| A stranger's passkey counts as the requester's. | The requester sends `X-Assay-Cosigner` and the host signs it into the body as `req.cosigner`. `verifyReceipt` checks only that key. | host `signs X-Assay-Cosigner into req.cosigner and rejects a malformed one`, SDK `a cosigner that never co-signed onchain fails exactly the cosigned check` |
| Co-sign a receipt that was never anchored, or claim another host's batch. | `cosign` and `cosignK` call `verifyReceipt(agentId, …)` first. | `test_cosign_notAnchored_reverts`, `test_cosign_otherHostsAgentId_reverts`, `test_cosignK_notAnchored_reverts`, `test_cosignK_otherHostsAgentId_reverts` |
| Reuse a signature made for another receipt. | The WebAuthn challenge must equal `receiptHash`. For `cosignK`, a signature over another hash recovers to an unrelated address. | `test_cosign_challengeIsOtherReceipt_reverts`, `test_cosignK_signatureOverOtherHash_cannotClaimSigner` |
| Passkey without user presence or verification. | `requireUV = true`, flags must include UP and UV. | `test_cosign_missingUP_reverts`, `test_cosign_missingUV_reverts` |
| Phishing site gets a passkey signature. OpenZeppelin's `WebAuthn.verify` does not check `origin` or `rpIdHash`. | The SDK and the web app check both offchain before relaying. | SDK `checks the origin exactly`, `checks the rpIdHash`, `refuses an assertion for a different rpId` |
| Spam the host's co-sign relay. | 10 relays per IP per hour, and only for anchored receipts this host issued. | host `limits each IP to 10 relays per hour`, `relays only anchored receipts this host issued` |

### Grades

| Attack | Defence | Test |
|---|---|---|
| Grade laundering by key rotation. A host with a bad grade rotates its key to start fresh. | `hostKey` for an Assay host is `keccak256("erc8004:<chainId>:<agentId>")`, so the grade follows the identity. A host can still register a new identity, so readers should weigh identity age and grade count. | SDK `hashes the ERC-8004 identity string`, harness `test_assay_host_key_uses_erc8004_identity` |
| Stale grade rollback. A verifier posts an older grade to overwrite a newer one. | `postGrade` requires `t` strictly newer than the verifier's stored grade for the same model and host. | `test_post_staleGrade_reverts` |
| Verifier identity transfer. The ERC-8004 identity is an NFT and can be sold, but the old address stays registered. | `postGrade` re-checks `ownerOf` on every post. | `test_post_afterIdentityTransferred_reverts` |
| Fake verifiers flood the registry. | `gradeOf` only reads the verifiers the reader passes in. | `test_gradeOf_ignoresUntrusted` |
| Impossible numbers. | `total > 0`, `passed <= total`, `ciLowBps <= ciHighBps <= 10000`, no future `t`. | `test_post_passedGtTotal_reverts`, `test_post_totalZero_reverts`, `test_post_ciInverted_reverts`, `test_post_ciOver10000_reverts`, `test_post_futureTimestamp_reverts` |
| Evidence that doesn't match the grade. | `evidence` is the sha256 of a deterministic tarball. The CRE workflow (in progress) re-checks the hash and recomputes the counts. | harness `test_evidence_hash_matches_tarball`, `test_evidence_is_deterministic` |
| Old grades presented as current. | `gradeStatus` returns `unknown` after 7 days and `warn` under 30 samples. | SDK `gradeStatus` table, e.g. `a grade older than 7 days → unknown` |

### CRE attestations

| Attack | Defence | Test |
|---|---|---|
| Call `onReport` directly. | Only the configured forwarder may call. | `test_onReport_nonForwarder_reverts`, `test_onReport_forwarderUnset_reverts` |
| Fake CRE workflow. The forwarder is shared by every CRE workflow, so any workflow could deliver a report. | `onReport` reads the workflow owner and id from the forwarder metadata and rejects any workflow except the pinned one. | `test_onReport_wrongWorkflowOwner_reverts`, `test_onReport_wrongWorkflowId_reverts`, `test_onReport_shortMetadata_reverts` |
| Reconfigure the attestor. | `configure` is owner only and runs once. | `test_configure_nonOwner_reverts`, `test_configure_twice_reverts` |
| Malformed report. | Exact length of 288 bytes, strict bool decoding, the same bounds as `postGrade`. | `test_onReport_wrongLength_reverts`, `test_onReport_dirtyBool_reverts`, `test_onReport_ciAbove100Percent_reverts` |

### Requests and the host

| Attack | Defence | Test |
|---|---|---|
| Salt brute force. Guess a short prompt such as "yes" from its hash. | Every commit is salted with 32 random bytes chosen by the requester. The host refuses requests without a 64-hex salt. | host `rejects a missing salt, a short salt and stream: true with 400`, SDK `newSalt is 32 random bytes`, `a different salt gives a different commit` |
| Provider fallback. OpenRouter silently routes to another provider. | The host pins `allow_fallbacks: false`. If the reported provider differs, it returns 502 and signs nothing. | host `pins with allow_fallbacks false only when a provider is set`, `returns 502 and signs nothing when the pinned provider did not serve the response` |
| Host signs for output it didn't return. | Commits are computed from the bytes the host returned, and `wrap` checks `res.commit` against the text the client received. | host `commits to the bytes received and returned, and returns the upstream JSON with receipt headers`, SDK `flags output that differs from what the host committed to` |
| Receipt header doesn't match the body. | `wrap` recomputes the hash and throws on mismatch. | SDK `throws when X-Assay-Receipt-Hash doesn't match the body` |
| Receipt double claim. A contract pays on a receipt, and the same receipt is presented twice. | This is the consumer's job. A contract that pays or credits on a receipt must store `receiptHash` as spent (SPEC section 8). `ReceiptAnchor` answers "was this anchored", which stays true forever. | None in Assay. Consumers must test their own nullifier. |

## Known limits

| Limit | What it means | Path forward |
|---|---|---|
| No proof of weights | A receipt proves which host served which bytes and what model it claimed. It does not prove which weights ran. Grades against the lab's own endpoint are the evidence for the model. | A host that signs from inside a TEE, with a model hash in the attestation quote. P-256 quotes verify with the same precompile. |
| ES384 attestations | NVIDIA's attestation tokens use ES384, and Monad has no P-384 precompile. | Verify offchain, or wrap the result in a P-256 signature. |
| Front-running as a class | Two of our attacks came from transactions visible in the mempool. Both are fixed in the contract layout. | An encrypted mempool such as BTX would remove the whole class at the protocol level. We have not routed through it yet because it has no public docs. |
| Identity reset | A host can register a fresh ERC-8004 identity to drop its history. | Readers weigh identity age and grade count. The indexer exposes both. |
| One verifier today | Assay runs the first verifier. | The registry is open, and the CRE workflow (in progress) re-checks grades on a DON. |
| Host key in a file | The reference host keeps its P-256 key in a local JWK file. | Cloud KMS, an HSM or a TEE. All of them sign P-256. |
| `cosignK` requester binding | v0.1 doesn't fix how `req.cosigner` names a secp256k1 signer, and `verifyReceipt` checks only P-256 co-signatures. | Fix the encoding in the spec and add the check to the SDK. |
