---
description: The five ideas every other page uses, with the exact formula behind each one.
icon: book
---

# Core concepts

**Where:** `SPEC.md` at the repo root defines all five. The SDK in `sdk/src` implements them, and `contracts/src` checks them onchain.

Assay has five moving parts. A host signs a receipt, the receipt carries commits, the host anchors batches, the requester can co-sign, and verifiers post grades.

## The five concepts

| Term | Meaning |
|---|---|
| Receipt | A small JSON body the host signs for every response. Its id is `receiptHash = sha256(JCS(body))`. |
| Commit | A salted hash of the prompt or the output. `req.commit = sha256(salt ‖ utf8(JCS({messages, params})))` and `res.commit = sha256(salt ‖ utf8(output))`. |
| Anchor | One onchain record per batch: the Merkle root of many receipt hashes, signed by the host's P-256 key, stored as `anchors[agentId][root]`. |
| Co-sign | An optional passkey signature by the requester over `receiptHash`, recorded as `cosigned[receiptHash][requesterKey]`. |
| Grade | A verifier's result for one model on one host: `passed`, `total`, a 95% Wilson interval in basis points and a hash of the raw logs. |

## Who does what

| Actor | Holds | Does |
|---|---|---|
| Requester | A fresh 32-byte salt per request, optionally a passkey | Sends `X-Assay-Salt`, keeps the salt, may co-sign |
| Host | A P-256 key, an ERC-8004 identity | Serves the model, signs receipts, anchors batches |
| Relayer | A wallet with MON | Sends `anchor` and `cosign` transactions. Anyone can relay, since authority comes from signatures |
| Verifier | An ERC-8004 identity, the harness | Tests hosts against the lab's endpoint and posts grades |
| Reader | A list of verifiers they trust | Calls `gradeOf` and `verifyReceipt` |

## How a receipt moves

1. The requester sends a chat request with a fresh salt in `X-Assay-Salt`.
2. The host forwards it to the model and computes both commits from the bytes it actually received and sent.
3. The host signs the receipt body as an ES256 JWS and returns it in the `X-Assay-Receipt` header.
4. Every `BATCH_SECONDS` (default 300) or `BATCH_MAX` receipts (default 64), the host anchors the batch root on Monad.
5. Anyone with the receipt and its Merkle proof can call `verifyReceipt(agentId, receiptHash, proof, root)`.
6. The requester can co-sign with a passkey. Verifiers count only the key named in `req.cosigner`.
7. Separately, verifiers post grades for the host, and readers pick whose grades count.

## Where else this shows up

| Concept | Deeper page |
|---|---|
| Receipt | [Receipts](../how-it-works/receipts.md) |
| Anchor | [Anchoring batches](../how-it-works/anchoring.md) |
| Co-sign | [Passkey co-signatures](../how-it-works/cosign.md) |
| Grade | [Verifiers and grades](../how-it-works/verifiers-and-grades.md) |
| Commit | [Privacy](../how-it-works/privacy.md) |
| Every term | [Glossary](../resources/glossary.md) |

{% hint style="warning" %}
The salt is the only thing that opens a commit. If the requester loses it, the receipt still proves the host signed something, but nobody can show which prompt or output it was.
{% endhint %}

Next: [Network and contracts](network-and-contracts.md)
