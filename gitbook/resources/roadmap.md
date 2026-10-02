---
description: What is live, what is being built now, and what comes after the hackathon.
icon: map
---

# Roadmap after Metropolis

**Where:** status comes from the repo README and the open items on [Network and contracts](../getting-started/network-and-contracts.md).

This page separates what runs today from what is next. Items move up when they ship, with a link to the evidence.

## Live on testnet

| Item | Evidence |
|---|---|
| `ReceiptAnchor` and `VerifierRegistry`, verified on Sourcify | [Network and contracts](../getting-started/network-and-contracts.md) |
| Host agent 1962 registered on ERC-8004 | Registration tx `0x4f164f1d…` |
| First anchor, checked by the P256 precompile | `docs/evidence/day3-anchor-verify.txt` |

## Built, waiting to ship

| Item | What's left |
|---|---|
| `cosignK` for per-app secp256k1 keys | Redeploy `ReceiptAnchor` |
| `CreAttestor` | Deploy and configure the forwarder and workflow |
| Reference host | A real host key, `setHostKey`, and hosting |
| Envio indexer | Envio Cloud deploy |
| Web app | Pick the final domain, since passkeys are bound to it |

## In progress

| Item | Page |
|---|---|
| Simulate and deploy the CRE re-check workflow (built and tested) | [Chainlink CRE](../integrations/chainlink-cre.md) |
| Report v1: every GLM-5.3 endpoint graded against Z.ai's own endpoint | [Hosting report](hosting-report.md) |
| Kimi trust agent | [Kimi](../integrations/kimi.md) |

## After Metropolis

| Item | Why |
|---|---|
| Hosts that sign from inside a TEE | A TEE quote that includes a model hash is the path to proving which weights ran |
| `anchorK` for secp256k1 hosts | Hosts whose node key is secp256k1 can anchor without a P-256 key |
| More grader checks | Context length, language following and model identity, beyond tool calls and `max_tokens` |
| CRE live spot checks | Nodes call a host directly on a schedule, so the DON becomes a verifier and not only a re-checker |
| ES384 support | NVIDIA attestation tokens use ES384. Monad has no P-384 precompile, so this needs offchain checks or a wrapper |

## Where else this shows up

| Place | What it covers |
|---|---|
| [Threat model](../security/threat-model.md) | Known limits that the roadmap addresses |
| [Welcome to Assay](../README.md) | Back to the start |

{% hint style="warning" %}
Testnet has been reset before, on 16 Dec 2025. The deploy is scripted so it can be repeated, but addresses on these pages may change after a reset.
{% endhint %}

Next: [Welcome to Assay](../README.md)
