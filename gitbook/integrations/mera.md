---
description: How one passkey keeps your salts encrypted, gives each app its own co-signer key, and opens one receipt at a time.
icon: key
---

# Mera

**Where:** `web/src/mera.ts` and the Vault tab of the [web app](../developers/web-app.md). Onchain, per-app keys are checked by `ReceiptAnchor.cosignK`.

Mera turns one passkey's PRF output into separate keys. Assay uses it for three namespaces, each a different primitive.

## Problem

A requester must keep the salt of every request. It's the only way to later prove that an output answered a prompt without publishing the prompt. Salts can't go to the host or sit in plain `localStorage`, because anyone holding a salt can brute-force a short prompt. Lose them and your receipts can't be opened.

There is a second problem. If one passkey co-signs receipts for every app, one public key links all your AI activity across apps.

## Why Mera

The same passkey, rpId and PRF salt always give the same 32 bytes, on every synced device, with nothing stored. A password-derived key can be forgotten or phished. A cloud KMS means a platform holds your keys. A seed phrase makes it a wallet.

## What we built

| Label | Primitive | Used for |
|---|---|---|
| `assay:vault:v1` | HKDF-SHA256, then AES-256-GCM | Encrypts receipts, salts and outputs. Only ciphertext is stored |
| `assay:requester:<appId>` | BIP-39 entropy, BIP-32 `m/44'/60'/0'/0/0`, secp256k1 | One unlinkable co-signer per app. Signs `receiptHash` with EIP-191 for `cosignK` |
| `assay:reveal:<receiptHash>` | HKDF-SHA256, then AES-256-GCM | Opens one receipt's entry and nothing else |

| Rule | How it holds |
|---|---|
| Salts are namespaced | Each PRF salt is `sha256(label)` |
| Encryption keys never sign, and signing keys never encrypt | Separate namespaces |
| Keys live briefly | The PRF output is used once and zeroed. The signing session ends with `session.end()` |
| Ciphertext can't move between namespaces | The label is AES-GCM associated data |

## How to try it

1. Open the web app on HTTPS or `localhost` with a PRF-capable passkey provider (iCloud Keychain, 1Password or Google Password Manager).
2. In Vault, click "Create a vault passkey", then save a receipt from Ask & co-sign.
3. Click "Show this browser's ciphertext" and copy it to a second device.
4. On that device, "Replace with pasted ciphertext" and unlock with the same synced passkey.
5. Click "Share this receipt" to make a disclosure key, and open it with "Open a disclosure" elsewhere.

## Where else this shows up

| Place | What it covers |
|---|---|
| [Passkey co-signatures](../how-it-works/cosign.md) | `cosign` and `cosignK` |
| [Privacy](../how-it-works/privacy.md) | What the salt protects |

{% hint style="warning" %}
On desktop Chrome, only passkeys saved to Google Password Manager return PRF. A passkey in the local profile fails with `PRF_UNAVAILABLE`. Hardware keys don't sync, so the second-device test needs a synced platform passkey.
{% endhint %}

Next: [MonadGuard and Mandate](other-teams.md)
