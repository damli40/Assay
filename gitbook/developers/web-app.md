---
description: The four tabs of the Assay web app, what each button does, and the exact messages you will see.
icon: window-maximize
---

# Web app

**Where:** `web/` (Vite, vanilla TypeScript). Run it with `pnpm --filter web dev` at `http://localhost:5173`. Every hash, signature and proof check goes through `@assay/receipts`.

One page, four tabs: Verify, Ask & co-sign, Grades and Vault. The dev server proxies `/host` to `HOST_TARGET` (default `http://localhost:8787`), so the default host URL in the app is `/host`.

## Verify

Paste a receipt and see every check on its own row, with pass, fail or skipped, a plain explanation, and a "Copy reproduce line" button.

| Field | Meaning |
|---|---|
| Receipt | The `X-Assay-Receipt` header value, or JSON `{body, jws}` |
| Salt (optional) | "The X-Assay-Salt sent with the request. Needed to open the commits." |
| Output text (optional) | "The assistant message exactly as received, whitespace included." |
| Messages JSON (optional) | The `messages` array you sent |
| Host base URL | "Used for /.well-known/jwks.json and /v1/receipts/:hash." |
| RPC URL, ReceiptAnchor | Under "Host and chain settings" |

| Row | `pass` means | Skipped text |
|---|---|---|
| Host signature | "The host's signature verifies against the keys it publishes at /.well-known/jwks.json." | |
| Body unchanged | "The receipt you hold is byte for byte the one the host signed." | "Needs a valid host signature first." |
| Signing key | "The key that signed is the one the receipt names in host.keyId." | "Needs a valid host signature first." |
| In the batch | "The Merkle proof places this receipt in the batch the host anchored." | "Needs the proof and root from the host. The receipt may not be anchored yet." |
| Anchored onchain | "ReceiptAnchor holds the batch root under the host's ERC-8004 agent id." | "Needs the batch root and a chain RPC." |
| Output matches | "Your salt and output text reproduce the output commit, so this is exactly the text the host served." | "Paste the salt and the output text to run it." |
| Prompt matches | "Your salt and messages reproduce the prompt commit, so this receipt answers that prompt." | "Paste the salt and the messages JSON to run it." |
| Requester co-signed | "The passkey named in req.cosigner co-signed this receipt onchain." | "The receipt names no co-signer, or no chain RPC was given." |

The summary reads "Done. No check failed." or "Done. At least one check failed." If the batch is still pending you see "The host has not anchored this receipt yet. Try again after the next batch."

## Ask & co-sign

1. Click "Register a passkey". Without one you can still ask, but you can't co-sign.
2. Type a question. The app sends it with `wrap(fetch, { cosigner })`, so the receipt names your passkey.
3. The answer shows with "Answer received with a signed receipt." and a check that "The output commit matches the bytes you received."
4. The app waits: "Waiting for the host's next batch to be anchored…". It gives up after 15 minutes.
5. Click "Co-sign with passkey". The app checks the assertion origin, then relays through `POST /v1/cosign` and shows "Co-signed onchain." with a MonadVision link.
6. Click "Save to vault" to keep the receipt, salt and output encrypted under your passkey.

## Grades

| Field | Meaning |
|---|---|
| Model | "Hashed as keccak256(model)." |
| Host | "An ERC-8004 agent id for an Assay host, or an OpenRouter provider tag such as deepinfra/fp8." |
| Trusted verifiers | "Grades count only from these addresses. Ties go to the one listed first." |
| Reference endpoint (optional) | "OpenRouter tag of the lab's own endpoint. With it, a host clearly below the reference shows as fail." |
| Evidence base URL (optional) | "Where the verifier publishes its log bundles, named by sha256." |

Click "Look up grade". The result shows status, pass count, the 95% interval, samples (n), the verifier, the evidence sha256 and an "Open evidence" link. Empty state: "None of the verifiers you trust has graded this model on this host. Add another verifier or check the host input."

## Vault

One passkey, three namespaces. Each uses its own PRF salt, `sha256(label)`, and each PRF output is used once and zeroed.

| Label | Primitive | Used for |
|---|---|---|
| `assay:vault:v1` | HKDF-SHA256, then AES-256-GCM | Encrypts your receipts, salts and outputs. Only ciphertext sits in `localStorage` |
| `assay:requester:<appId>` | BIP-39 entropy, BIP-32 `m/44'/60'/0'/0/0`, secp256k1 | One signing identity per app, for `cosignK`. The key lives for one signature, then `session.end()` wipes it |
| `assay:reveal:<receiptHash>` | HKDF-SHA256, then AES-256-GCM | A disclosure key that opens one receipt's entry and nothing else |

| Button | What it does |
|---|---|
| "Create a vault passkey" | Makes a PRF passkey for the vault |
| "Encrypt and add" | Adds a receipt you paste |
| "Share this receipt" | Derives the reveal key: "The key opens this entry only, never the rest of the vault." |
| "Show this browser's ciphertext" / "Replace with pasted ciphertext" | Moves the vault to another device. Unlock there with the same synced passkey |
| "Open a disclosure" | Opens one shared receipt. "No passkey needed on this side." |

## Where else this shows up

| Place | What it does |
|---|---|
| [SDK reference](sdk.md) | `verifyReceipt`, `wrap`, `cosignReceipt`, `gradeOf` |
| [Host API](host-api.md) | The routes each tab calls |
| [Mera](../integrations/mera.md) | Why the vault uses passkey PRF |

{% hint style="warning" %}
Passkeys are bound to the domain (rpId). A passkey made on `localhost` does not work on the deployed site, and the vault and requester keys change with it. On desktop Chrome, a passkey saved to the local profile returns `PRF_UNAVAILABLE`. Save it to Google Password Manager, iCloud Keychain or 1Password.
{% endhint %}

Next: [Monad](../integrations/monad.md)
