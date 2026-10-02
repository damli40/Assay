---
description: How a requester proves "I asked for this" by signing the receipt hash with a passkey, checked onchain.
icon: signature
---

# Passkey co-signatures

**Where:** `ReceiptAnchor.cosign` (P-256 passkeys) and `ReceiptAnchor.cosignK` (secp256k1 keys). SDK `registerPasskey`, `cosignReceipt` and `assertionToWebAuthnAuth`. Host route `POST /v1/cosign`. The Ask & co-sign tab in the web app.

Co-signing is optional. The requester signs `receiptHash` with a passkey, and the contract checks the WebAuthn assertion through the P256 precompile. A `cosign` call costs about 73,000 gas.

## Terms

| Term | Meaning |
|---|---|
| Challenge | The 32 raw bytes of `receiptHash`. In `clientDataJSON` it appears as `base64url(receiptHash)`. |
| `requesterKey` | `keccak256(abi.encode(qx, qy))` of the passkey's public key. SDK `requesterKeyHash`. |
| `X-Assay-Cosigner` | Request header with the `requesterKey` (0x + 64 hex). The host signs it into the body as `req.cosigner`. |
| `cosigned[receiptHash][requesterKey]` | `true` once that key co-signed that receipt. |
| `cosignedK[receiptHash][signer]` | The same record for a secp256k1 signer address. |
| UV | User verified. `requireUV = true` on the deployed contract, so the authenticator flags must include UP and UV (`0x05`). |

## Steps

1. Register a passkey once with `registerPasskey({ rpId, userName })`. Keep `credentialId`, `qx`, `qy` and `keyHash`.
2. Ask through the host with `wrap(fetch, { cosigner: keyHash })`. The receipt now carries `req.cosigner`.
3. Wait until the batch is anchored. `GET /v1/receipts/:hash` returns `status: "anchored"`.
4. Call `cosignReceipt(receiptHash, { rpId, credentialId })`. It converts the DER signature to raw `r`, `s`, normalizes `s`, finds `typeIndex` and `challengeIndex`, and checks the rpIdHash.
5. Send it onchain yourself, or post `{receiptHash, qx, qy, auth}` to the host's `POST /v1/cosign` so the host pays gas.
6. The contract emits `Cosigned(receiptHash, requesterKey, agentId, root)`.

## Revert reasons

| Error | When |
|---|---|
| `ReceiptNotAnchored()` | The proof doesn't place the receipt under a root this agent anchored. |
| `AlreadyCosigned()` | This key (or signer) already co-signed this receipt. |
| `BadCosignature()` | Wrong challenge, wrong key, missing UP or UV flag, tampered data, or a high `s`. For `cosignK`, a malformed signature. |

## Checks the contract does not do

OpenZeppelin's `WebAuthn.verify` skips the origin and the rpIdHash. Run these offchain:

| Check | SDK function |
|---|---|
| `clientDataJSON.origin` equals your site | `checkOrigin(clientDataJSON, expectedOrigin)` |
| `authenticatorData[0..32]` equals `sha256(rpId)` | `checkRpIdHash(authenticatorData, rpId)` |

## Where else this shows up

| Place | What it does |
|---|---|
| [SDK reference](../developers/sdk.md) | WebAuthn helpers with examples |
| [Host API](../developers/host-api.md) | `POST /v1/cosign` request body and status codes |
| [Web app](../developers/web-app.md) | "Register a passkey" and "Co-sign with passkey" buttons |
| [Mera](../integrations/mera.md) | Per-app secp256k1 keys for `cosignK` |

{% hint style="warning" %}
A passkey can sign any challenge, so anyone who learns a receipt hash can co-sign it with their own key. The contract records every valid co-signature, one per key. Only the one whose key hash equals `req.cosigner` means "this person asked". Verifiers must ignore the rest.
{% endhint %}

Next: [Verifiers and grades](verifiers-and-grades.md)
