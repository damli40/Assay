# Receipt interop

Assay and [MonadGuard](https://github.com/poteshniy/monadguard) sign receipts in the same envelope: an ES256 compact JWS whose payload is the RFC 8785 (JCS) bytes of the receipt, with the key published at `/.well-known/jwks.json`, and `receiptHash = sha256(payload)`. Each project checks the other's receipts in CI, from files pinned in its own repo, so a build never depends on the other side's server being up.

MonadGuard checks the tool. Assay checks the model host that answered.

## What each side verifies

1. The header `alg` is ES256.
2. The `kid` resolves to a key in the published JWKS.
3. The key is on P-256.
4. The signature verifies against that key.
5. The payload parses as JSON.
6. The payload is byte for byte what the verifier's own JCS produces from the parsed object.
7. `receiptHash = sha256(payload)` matches the published hash.

## Results

| Date | Verifier (commit) | Receipts checked | Result |
|---|---|---|---|
| 3 Oct 2026 | Assay SDK (`sdk/src/jcs.ts`, jose), see `sdk/test/interop.test.ts` | 3 MonadGuard receipts, Monad mainnet | All pass |
| 4 Oct 2026 | MonadGuard `scripts/verify-foreign.mjs` (`bbacb8b`) | Assay receipt `0x9a166cac…07e5`, Monad testnet | 10 of 10 checks pass, including byte-exact JCS |

## Files

- `assay-receipts/<receiptHash>.json`: Assay receipts for other verifiers to pin. Each file has the `jws`, the `jwks` it verifies against, and the anchor (contract, agent id, Merkle root, proof, tx) on Monad.
- `sdk/test/fixtures/monadguard/`: MonadGuard receipts and JWKS that Assay's CI verifies on every push.
