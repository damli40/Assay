# web

The Assay web app. Vite and vanilla TypeScript, one page with four tabs. It uses `@assay/receipts` for every hash, signature and proof check.

## Run

```bash
corepack pnpm install
corepack pnpm --filter @assay/host dev     # http://localhost:8787
corepack pnpm --filter web dev             # http://localhost:5173
corepack pnpm --filter web test
corepack pnpm --filter web typecheck
corepack pnpm --filter web build           # writes web/dist
```

The host sends no CORS headers. The dev and preview servers proxy `/host` to `HOST_TARGET` (default `http://localhost:8787`), so the default host URL in the app is `/host`. For a deployed build, serve the host under the same origin or set `VITE_HOST_URL` at build time to a host that allows this origin and exposes `X-Assay-Receipt`.

## Pages

| Tab | What it does |
|---|---|
| Verify | Paste a receipt (the `X-Assay-Receipt` value or JSON `{body, jws}`), plus the salt, output and messages if you kept them. Fetches the JWKS and Merkle proof from the host, reads `ReceiptAnchor` over RPC and runs `verifyReceipt`. Each check gets a row with pass, fail or skipped, a plain explanation and a reproduce line you can copy. |
| Ask & co-sign | Registers a P-256 passkey, asks through the host with `wrap(fetch, {cosigner})`, waits for the batch to be anchored, then co-signs with the passkey and relays through `POST /v1/cosign`. Shows the transaction on MonadVision. |
| Grades | Looks up `gradeOf(model, hostKey, trusted)` on `VerifierRegistry` and shows status, pass count, 95% interval, n and the evidence hash. A host is an agent id (`hostKeyForAgent`) or an OpenRouter tag (`hostKeyForEndpoint`). |
| Vault | Mera passkey PRF used for three separate keys. See below. |

## Vault namespaces

Each namespace uses its own PRF salt, `sha256(label)`. One passkey prompt gives one 32-byte PRF output. It is used once and zeroed. Nothing derived from it is stored.

| Label | Primitive | Used for |
|---|---|---|
| `assay:vault:v1` | HKDF-SHA256, then AES-256-GCM | Encrypts your list of receipts, salts and outputs. Only the ciphertext sits in `localStorage`. |
| `assay:requester:<appId>` | BIP-39 entropy, BIP-32 `m/44'/60'/0'/0/0`, secp256k1 | One signing identity per app. Signs `receiptHash` with EIP-191 for `cosignK`. The key lives in a Mera session for one signature, then `session.end()` wipes it. |
| `assay:reveal:<receiptHash>` | HKDF-SHA256, then AES-256-GCM | A disclosure key for one receipt. It opens that receipt's entry and nothing else. |

Every ciphertext carries its label as AES-GCM associated data, so a blob sealed under one namespace or receipt will not open under another.

`localStorage` holds only public data: the passkey credential id, `qx`, `qy`, the co-signer key hash and the vault ciphertext.

## Passkey notes

| Case | What happens |
|---|---|
| Desktop Chrome with a passkey in the local profile | Mera returns `PRF_UNAVAILABLE`. Save the passkey to Google Password Manager, iCloud Keychain or 1Password. |
| Different domain | Passkeys are bound to the rpId (`location.hostname`). A `localhost` passkey does not work on the deployed domain, and the vault and requester keys change with it. |
| Second device | Use a synced platform passkey. Copy the vault ciphertext over, then unlock with the same passkey. |

## Layout

| Path | Contents |
|---|---|
| `src/lib/` | Logic without DOM: receipt parsing, host client, host key choice, vault crypto |
| `src/mera.ts` | Passkey PRF calls and vault storage |
| `src/views/` | One file per tab |
| `test/` | Vitest. View tests run in happy-dom |
