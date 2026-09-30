# Assay receipts: spec v0

An Assay receipt is a small signed record that travels with an AI response. Anyone holding one can later check four things:

1. Which host served the response. The host's signature is tied to its ERC-8004 identity.
2. Which model the host claimed to run. The model field is signed along with everything else.
3. Whether that host passed its last audit, according to verifiers the reader chooses to trust.
4. Who asked for the response, if the requester co-signed it with a passkey. This part is optional.

The prompt and the output never go onchain. Only salted hashes of them do, and the person holding the receipt decides what to reveal.

A receipt proves who served which bytes and what they claimed about it. It does not prove which weights actually ran, and AntSeed says the same about its own signed responses. The link to the real model comes from the grades in section 5, where verifiers test the host against the lab's own endpoint and publish results anyone can recompute.

## 1. Receipt body

The body is canonical JSON (RFC 8785, JCS). MonadGuard signs the same canonical form, so one verifier can handle both kinds of receipt.

```json
{
  "v": "assay-receipt/0",
  "model": "z-ai/glm-5.3",
  "host": {
    "agentId": "erc8004:10143:42",
    "keyId": "host-key-2026-09",
    "alg": "ES256"
  },
  "req": {
    "commit": "0x<sha256(salt || JCS(messages, params))>",
    "params": { "temperature": 0, "max_tokens": 512 }
  },
  "res": {
    "commit": "0x<sha256(salt || output_text)>",
    "tokensIn": 812,
    "tokensOut": 143,
    "finish": "stop"
  },
  "price": { "asset": "USDC", "amount": "0.00041" },
  "t": 1790500000000,
  "nonce": "0x<16 random bytes>"
}
```

The requester generates a fresh 32-byte salt for each request and sends it in the `X-Assay-Salt` header. Without a salt, short prompts like "yes" could be brute-forced from their hash.

The host computes both commits from the bytes it actually received and sent, so it can't sign for a request it didn't serve.

The receipt hash is `receiptHash = sha256(JCS(body))`, and it's the value every signature covers.

## 2. Signatures

| Signer | Scheme | Where the key lives | How Monad checks it |
|---|---|---|---|
| Host | `ES256` (ECDSA P-256) | Cloud KMS, an HSM, or a TEE. Intel's quoting enclave signs with NIST P-256. | P256VERIFY precompile at `0x0100` |
| Host (AntSeed-style) | `ES256K` (secp256k1, EIP-191 with a domain tag) | The node key. AntSeed peers use "a secp256k1 private key" and `personal_sign` | `ecrecover` |
| Requester | WebAuthn assertion (P-256), challenge = `receiptHash` | The user's passkey | Parse `authenticatorData` and `clientDataJSON`, then P256VERIFY |
| Requester (unlinkable) | secp256k1 key derived from the passkey's PRF output (Mera `getPasskeyPrfOutput`) with a per-app salt. See section 7, note 3 | Nowhere. It's re-derived from the passkey each time | `ecrecover` |

P256VERIFY takes 160 bytes (`hash ‖ r ‖ s ‖ x ‖ y`) and returns 1 on success.

Host signatures are published as JWS, with the host's keys at `/.well-known/jwks.json`. MonadGuard uses the same convention.

## 3. Anchoring

Hosts don't send a transaction per request. They batch receipts like this:

1. Every N seconds or M receipts, the host builds a Merkle tree of `receiptHash` values.
2. It signs the root and calls `ReceiptAnchor.anchor(root, count, sig)`.
3. The contract checks the signature against the host's registered key, so nobody can anchor a batch the host didn't sign.
4. Anyone can then check a single receipt with `verifyReceipt(receiptHash, proof, root)`, which takes a Merkle proof and the anchored root.

## 4. Requester co-signature (optional)

The client calls `navigator.credentials.get` with `challenge = receiptHash`. The contract, or any offchain verifier, then does the following:

1. It checks that `clientDataJSON.type == "webauthn.get"` and `clientDataJSON.challenge == base64url(receiptHash)`.
2. It checks the user-present flag in `authenticatorData`.
3. It computes `h = sha256(authenticatorData ‖ sha256(clientDataJSON))`.
4. It calls P256VERIFY with `h, r, s` and the credential's public key `x, y`.

Receipts are keyed by `receiptHash` and not by signature bytes, so signature malleability can't produce a duplicate receipt.

## 5. Grades from open verifiers

Anyone can be a verifier. A verifier registers an ERC-8004 identity and publishes grades to `VerifierRegistry`:

```
Grade {
  model        bytes32   // keccak256("z-ai/glm-5.3")
  hostKey      bytes32   // hash of the host's public key
  checks       bytes32   // hash of the check suite version
  passed       uint32
  total        uint32
  ciLowBps     uint16    // 95% Wilson interval, basis points
  ciHighBps    uint16
  refModel     bytes32   // reference endpoint used (the lab's own API)
  evidence     bytes32   // sha256 of the raw log bundle, published offchain
  t            uint64
}
```

Readers call `gradeOf(model, hostKey, trustedVerifiers[])` and choose whose grades count. ERC-8004 recommends the same pattern for reputation, because unfiltered feedback is easy to spam. Assay runs the first verifier, but the registry doesn't depend on Assay in any way.

## 6. Out of scope for v0

A receipt can't prove which weights ran. That becomes possible when the host signs from inside a TEE whose attestation quote includes a model hash, and it's the likely next step after v0.

ES384 keys aren't supported. NVIDIA's attestation tokens use ES384, and Monad has no P-384 precompile, so those tokens have to be verified offchain or wrapped later.

Hosts get no privacy. They are public by design, and only requesters can stay private.

## 7. Implementation notes (v0.1)

These notes pin down details that the sections above leave open. They come from running the libraries and the Monad testnet precompile directly.

1. Signatures must use low `s`. WebCrypto and passkeys return a high `s` roughly half the time, and OpenZeppelin's `P256` rejects those. The SDK sets `s = N - s` before anything goes onchain.
2. User verification is required. OpenZeppelin's `WebAuthn.verify` defaults to `requireUV = true` and Mera's PRF always requires it, so test vectors use flags `0x05` (UP and UV).
3. Mera per-app requester keys are secp256k1, since Mera's signing sessions don't offer P-256. The key follows Mera's documented BIP-39/BIP-32 path from a per-app PRF salt `sha256("assay:requester:<appId>")`, and the contract checks it with `ecrecover` over an EIP-191 digest of `receiptHash`.
4. Merkle leaves use OpenZeppelin's `StandardMerkleTree` with leaf type `["bytes32"]`. Each leaf is `keccak256(bytes.concat(keccak256(abi.encode(receiptHash))))`, which matches OpenZeppelin's `MerkleProof`.
5. The anchor message is `abi.encode(keccak256("assay-anchor/0"), chainid, anchorContract, agentId, root, count)`. The host signs it with ES256, so the contract verifies against `sha256(message)`. Including the chain ID and contract address stops a signature from being replayed on another chain or deployment.
6. For hosts that sign with an Assay key, `hostKey = keccak256(abi.encode(qx, qy))`. Graded endpoints without a key, such as every OpenRouter endpoint, use `keccak256(abi.encodePacked("openrouter:", tag))`.
