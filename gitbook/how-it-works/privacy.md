---
description: What goes onchain, what stays with you, and what the host sees.
icon: eye-slash
---

# Privacy

**Where:** the commits in `sdk/src/commit.ts`, the `anchor` and `cosign` calldata on `ReceiptAnchor`, and the host's store in `host/data/`.

The prompt and the output never go onchain. Only salted hashes do, and only the person holding the salt can open them.

## Where each piece of data lives

| Data | Onchain | Host | You |
|---|---|---|---|
| Prompt and output text | Never | Sees them while serving. Stores only the receipt | Yes |
| Salt | Never | Receives it in `X-Assay-Salt` | Yes. Keep it |
| `req.commit`, `res.commit` | Not directly. Only the receipt hash inside a Merkle root | In the receipt | In the receipt |
| Receipt hash | Only when someone co-signs it (calldata and the `Cosigned` event) | Yes | Yes |
| Merkle root and count | Yes, one per batch | Yes | From `GET /v1/receipts/:hash` |
| Passkey public key | Its hash in `Cosigned`, `qx` and `qy` in calldata | Only if you use the relay | Yes |
| Host identity and keys | Yes, public by design | Yes | Yes |

## Why the salt matters

Without a salt, a short prompt like "yes" could be found by hashing every likely answer. With a fresh 32-byte salt per request, the commit reveals nothing until you hand over the salt.

## How you reveal one receipt

1. Give the verifier the receipt, the salt, and the output (and the messages, if the prompt matters).
2. They run `verifyReceipt` with `salt`, `output`, `messages` and `params`.
3. `outputCommit` and `promptCommit` pass only if every byte matches.

The web app's Vault can also create a disclosure key for one receipt (`assay:reveal:<receiptHash>`), which opens that entry and nothing else.

## Where else this shows up

| Place | What it does |
|---|---|
| [Receipts](receipts.md) | The commit formulas |
| [Mera](../integrations/mera.md) | Keeps salts encrypted under your passkey, and gives each app its own unlinkable co-signer key |
| [Threat model](../security/threat-model.md) | What a host or observer can still learn |

{% hint style="warning" %}
Hosts get no privacy, by design. Requesters can stay private, but a co-signature with the same passkey across apps links that activity through one public key. Use a per-app key if that matters to you.
{% endhint %}

Next: [SDK reference](../developers/sdk.md)
