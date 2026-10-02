---
description: The design decisions behind the contracts and host, what each one chose, and what it turned down.
icon: clipboard-list
---

# Design decisions

**Where:** the code each decision changed: `contracts/src/`, `sdk/src/hostKey.ts`, `host/src/server.ts` and `SPEC.md`.

This is the public part of Assay's decision log. Each entry says what was chosen and why. A later entry can replace an earlier one, and old entries are never edited.

## Decisions

| Id | Decision | Why |
|---|---|---|
| D15 | The anchor record stores only `count` and `anchoredAt`. The signing key hash goes in the `Anchored` event | A third storage slot adds about 20,000 gas to every anchor, and indexers read events anyway |
| D16 | `anchor` rejects `count == 0` with `EmptyBatch` | An empty batch holds no receipt, so anchoring one only wastes gas |
| D17 | The mutated-proof fuzz test runs against the 8-leaf tree built in TypeScript | It checks the onchain proof logic against the SDK's own trees |
| D18 | Anchors are keyed per host, `anchors[agentId][root]`. Replaces the layout in D15 | With a global key, any host could copy a pending root and anchor it first. `anchor` dropped from about 83,000 to about 61,000 gas |
| D19 | Co-signatures are stored per requester key, and the body names the requester as `req.cosigner` | With one slot per receipt, anyone watching the mempool could co-sign first. The contract can't see the body, so the binding lives there |
| D20 | `postGrade` re-checks ERC-8004 ownership every time and rejects stale grades | An identity is an NFT and can be sold. A verifier must not roll back its own record |
| D21 | Grades follow the host's identity, `keccak256("erc8004:<chainId>:<agentId>")`, not its key | Rotating a key must not wipe a bad grade. Unkeyed endpoints keep `keccak256("openrouter:" + tag)` |
| D22 | A contract that pays on a receipt must store `receiptHash` as spent. Hosts keep retired keys in the JWKS | Receipts prove origin, they are not bearer tickets. Old receipts must still verify after a rotation |
| D25 | A per-app secp256k1 requester puts its address, left-padded to 32 bytes, in `req.cosigner` | So a `cosignK` co-signature is bound to the requester the same way a passkey co-signature is |

## Earlier choices these build on

| Choice | Why |
|---|---|
| OpenZeppelin 5.7.0 for `P256`, `WebAuthn` and `MerkleProof` | Audited, uses the `0x0100` precompile, rejects high `s` |
| `evm_version = "osaka"` pinned, canary tests kept | Under `prague` the precompile is missing and gas jumps to about 250,000 per check |
| JCS (RFC 8785) plus sha256 for receipts | Byte-identical across languages, and sha256 is what WebCrypto, passkeys and JWS use |
| Domain-separated anchor message | Stops replay across chains, deployments and hosts, and stops a relayer from changing `count` |
| Anyone can relay `anchor` | Authority comes from the host's P-256 signature, so the key can live in a KMS or TEE with no wallet |
| Separate host and verifier wallets | ERC-8004's ReputationRegistry blocks an owner from rating its own agent |

## Where else this shows up

| Place | What it covers |
|---|---|
| [Threat model](threat-model.md) | The test behind D18, D19 and D20 |
| [Verifiers and grades](../how-it-works/verifiers-and-grades.md) | D21 host keys in practice |
| [Host API](../developers/host-api.md) | D22 retired keys in the JWKS |

{% hint style="warning" %}
D22 is a rule for anyone building on Assay, not something the contracts enforce. If your contract pays or grants access on a receipt and doesn't record `receiptHash` as spent, the same receipt can be used twice.
{% endhint %}

Next: [Hosting report](../resources/hosting-report.md)
