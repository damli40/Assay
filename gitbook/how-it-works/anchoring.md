---
description: How the host batches receipt hashes into a Merkle tree and commits the root on Monad with one P-256 signature.
icon: anchor
---

# Anchoring batches

**Where:** `ReceiptAnchor.anchor` and `ReceiptAnchor.verifyReceipt` onchain. The host's batcher in `host/src/batcher.ts`. SDK `buildBatch`, `anchorMessage` and `createHostSigner().signAnchor`.

The host does not send a transaction per request. It collects receipt hashes, builds a Merkle tree, signs the root and anchors it in one call to `anchor`, which costs about 61,000 gas.

## Terms

| Term | Meaning |
|---|---|
| Leaf | `keccak256(bytes.concat(keccak256(abi.encode(receiptHash))))`, the OpenZeppelin `StandardMerkleTree` leaf for `["bytes32"]`. |
| Root | The Merkle root of one batch. |
| `count` | Number of receipts in the batch. Must be above zero. |
| Anchor message | `abi.encode(keccak256("assay-anchor/0"), chainid, anchorContract, agentId, root, count)`. |
| Host signature | ES256 over the anchor message. The contract checks it against `sha256(message)` with the P256 precompile. |
| `anchors[agentId][root]` | The stored record: `count` and `anchoredAt`. `anchoredAt != 0` means anchored. |
| `BATCH_SECONDS` | Anchor interval, default 300. |
| `BATCH_MAX` | Anchor at once when this many receipts wait, default 64. |

## How it works

1. Every `BATCH_SECONDS`, or as soon as `BATCH_MAX` receipts wait, the host takes the queue. An empty queue is never anchored.
2. `buildBatch(hashes)` builds the tree and one proof per receipt.
3. `signAnchor` signs the anchor message and normalizes `s` to the low half.
4. The relayer sends `anchor(agentId, root, count, r, s)` with `gas = estimate × 1.2`, because Monad bills the gas limit.
5. On an RPC error the host retries once on `MONAD_RPC_URL_2`. A reverted transaction counts as a failure and the receipts stay queued.
6. The contract checks the key, the count, replay and the signature, then stores the record and emits `Anchored(agentId, root, count, keyHash)`.
7. `GET /v1/receipts/:hash` now returns the root, the proof, the anchor transaction and a ready `cast call` line.

## What's checked when

The contract checks one signature per batch when it's written: the host's P-256 signature over the Merkle root. Each receipt is checked when someone reads it: the host's ES256 signature against its published keys, plus the Merkle proof against an anchored root. Registries that verify every record on the way in, as [MonadGuard](../integrations/other-teams.md) does, give a stronger guarantee per row and pay for it on every row. Assay keeps the onchain cost to one check per batch and leaves the per-receipt check to the reader.

## Revert reasons

| Error | When |
|---|---|
| `UnknownHost()` | The agent has no host key set. |
| `EmptyBatch()` | `count == 0`. |
| `RootAlreadyAnchored()` | This host already anchored this root. |
| `BadHostSignature()` | The signature does not match the host key, the count was changed, `s` is high, or the message names another chain or contract. |

## Check a receipt yourself

```bash
cast call 0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24 \
  "verifyReceipt(uint256,bytes32,bytes32[],bytes32)(bool)" \
  1962 <receiptHash> "[<proof>]" <root> --rpc-url https://testnet-rpc.monad.xyz
```

`verifyReceipt` returns `false` (it never reverts) when the root is not anchored under that agent or the proof does not match.

## Where else this shows up

| Place | What it does |
|---|---|
| [Contracts reference](../developers/contracts.md) | Full signatures, events and gas |
| [Host API](../developers/host-api.md) | `GET /v1/receipts/:hash` and the `reproduce` block |
| [Indexer and GraphQL](../developers/indexer.md) | The `Anchor`, `HostKey` and `HostActivity` entities |
| [Threat model](../security/threat-model.md) | Why anchors are keyed per host |

{% hint style="warning" %}
Anyone can relay `anchor`, because authority comes from the host's P-256 signature and not from `msg.sender`. A relayer can't change `root` or `count`, but it can choose not to send. A receipt reads as pending until its batch lands.
{% endhint %}

Next: [Passkey co-signatures](cosign.md)
