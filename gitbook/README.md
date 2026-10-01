---
description: What Assay is, the problem it answers, and where to start reading.
icon: house
---

# Welcome to Assay

**Where:** the code is at [github.com/trudransh/Assay](https://github.com/trudransh/Assay). The contracts run on Monad testnet (chain 10143).

Assay gives every AI response a signed receipt. The host signs it, you can co-sign it with a passkey, and Monad checks both signatures onchain. Open verifiers grade hosts against the lab's own endpoint, and you choose which verifiers you trust.

## The problem in numbers

On 26 Sep 2026 OpenRouter's public API listed the following for open-weight models. Every number comes from the [hosting report](resources/hosting-report.md).

| Measure | Value |
|---|---|
| Distinct endpoints for 140 open-weight models | 735, from 56 providers |
| Endpoints whose precision field reads `unknown` | 289 (39%) |
| Endpoints that declare a 4-bit format | 107 (15%) |
| GLM-5.3 endpoints | 37, of which 16 state no precision and 8 declare 4-bit |
| GLM-5.3 output price range | $1.19 to $8.80 per million tokens |
| DeepSeek V4 Flash on GPQA, lab API vs. one host (measured by Olly) | 90% vs. 75% |

The text you get back carries no proof of who served it. The checks that exist today stay inside the platform that ran them.

## What a receipt proves

| Question | How Assay answers it |
|---|---|
| Which host served this response? | The host's ES256 signature, tied to its ERC-8004 identity. |
| Which model did the host claim? | The `model` field is inside the signed body. |
| Was this receipt in a batch the host committed to? | A Merkle proof against a root anchored in `ReceiptAnchor`. |
| Did the host pass its last audit? | `gradeOf` in `VerifierRegistry`, filtered by the verifiers you trust. |
| Who asked? | An optional passkey co-signature, checked onchain. |

A receipt proves who served which bytes and what they claimed. It does not prove which weights ran. Grades from verifiers cover that gap.

## Where to start

| You want to | Read |
|---|---|
| Verify a receipt on your machine in a few minutes | [Quickstart](getting-started/quickstart.md) |
| Learn the five ideas everything else uses | [Core concepts](getting-started/core-concepts.md) |
| Find a contract address or an ERC-8004 id | [Network and contracts](getting-started/network-and-contracts.md) |
| Call the SDK, the host or the contracts | [For developers](developers/sdk.md) |
| See what can go wrong and which test covers it | [Threat model](security/threat-model.md) |

{% hint style="warning" %}
Assay runs on Monad testnet. The contracts are verified and live, but testnet has been reset before (16 Dec 2025), so check the addresses on [Network and contracts](getting-started/network-and-contracts.md) before you rely on them.
{% endhint %}

Next: [Quickstart](getting-started/quickstart.md)
