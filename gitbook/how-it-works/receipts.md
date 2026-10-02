---
description: Every field of a receipt body, how it is hashed and signed, and how it reaches you.
icon: receipt
---

# Receipts

**Where:** SDK `buildReceipt` and `receiptHash` in `sdk/src/receipt.ts`. The host returns each receipt in the `X-Assay-Receipt` header of `POST /v1/chat/completions`.

A receipt is canonical JSON that the host signs for every response. Its id is `receiptHash = sha256(JCS(body))`, and every signature and Merkle proof refers to that hash.

## Fields

| Field | Meaning |
|---|---|
| `v` | Always `"assay-receipt/0"`. |
| `model` | The model the host claims it ran, for example `"z-ai/glm-5.3"`. |
| `host.agentId` | The host's ERC-8004 identity as `"erc8004:<chainId>:<agentId>"`, for example `"erc8004:10143:1962"`. |
| `host.keyId` | The `kid` of the signing key in the host's JWKS. |
| `host.alg` | `"ES256"` (P-256). `"ES256K"` is reserved for secp256k1 hosts. |
| `req.commit` | `sha256(salt ‖ utf8(JCS({messages, params})))`. |
| `req.params` | Every request field except `messages`, `model`, `stream` and `provider`, as the client sent it. |
| `req.cosigner` | Optional. `keccak256(abi.encode(qx, qy))` of the passkey allowed to co-sign. Set from the `X-Assay-Cosigner` header. |
| `res.commit` | `sha256(salt ‖ utf8(output))`, where output is `choices[0].message.content` exactly as returned. |
| `res.tokensIn`, `res.tokensOut` | Token counts from the upstream `usage`, as non-negative integers. |
| `res.finish` | The upstream `finish_reason`, or `"unknown"`. |
| `price` | Optional `{asset, amount}`, with `amount` as a string. |
| `t` | Issue time in Unix milliseconds, a positive integer. |
| `nonce` | 16 random bytes as hex. |

## Example body

```json
{
  "v": "assay-receipt/0",
  "model": "z-ai/glm-5.3",
  "host": { "agentId": "erc8004:10143:1962", "keyId": "host-key-2026-09", "alg": "ES256" },
  "req": { "commit": "0x…", "params": { "temperature": 0, "max_tokens": 512 } },
  "res": { "commit": "0x…", "tokensIn": 812, "tokensOut": 143, "finish": "stop" },
  "t": 1790500000000,
  "nonce": "0x…"
}
```

## How a receipt is made

1. You send a request with `X-Assay-Salt`: 32 random bytes as 64 hex characters, with or without `0x`.
2. The host forwards the request and gets the model's answer.
3. The host computes `req.commit` from the bytes it received and `res.commit` from the text it returns.
4. The host signs the JCS bytes of the body as a compact ES256 JWS. The JWS payload is exactly `JCS(body)`.
5. The host returns `X-Assay-Receipt` (base64url of the JSON `{body, jws}`) and `X-Assay-Receipt-Hash`.
6. The receipt waits in the host's queue until the next batch is anchored.

## Errors when building a receipt

| Error | Cause |
|---|---|
| `req.commit must be 32 bytes of hex` | The commit is not a 32-byte hex string. The same check runs for `res.commit` and `req.cosigner`. |
| `res.tokensIn must be a non-negative integer` | A token count is a float, negative or unsafe. |
| `t must be a positive integer (ms)` | `t` is zero, negative or not an integer. |
| `jcs: undefined at $.…` | A field holds `undefined`, which JCS cannot represent. |

## Where else this shows up

| Place | What it does |
|---|---|
| [SDK reference](../developers/sdk.md) | `buildReceipt`, `receiptHash`, `verifyReceiptJws`, `wrap` |
| [Host API](../developers/host-api.md) | The headers and status codes around a receipt |
| [Web app](../developers/web-app.md) | The Verify tab accepts the `X-Assay-Receipt` value as is |
| [Anchoring batches](anchoring.md) | What happens to the receipt hash next |

{% hint style="warning" %}
Assay's own fields stay integers or strings so every JCS library hashes them the same way. `req.params` may still hold floats such as `temperature: 0.7`. A verifier in another language must use an RFC 8785 conformant JCS library, or its hash will not match.
{% endhint %}

Next: [Anchoring batches](anchoring.md)
