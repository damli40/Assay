---
description: How a Chainlink CRE workflow re-checks every posted grade on a decentralized oracle network and records the result on Monad.
icon: link
---

# Chainlink CRE

**Where:** `CreAttestor` in `contracts/src/CreAttestor.sol` (written and tested, not deployed yet). The workflow lives in `cre/`.

{% hint style="info" %}
Built and tested, not deployed yet. The workflow in `cre/grade-recheck/` has 27 tests and compiles to WASM. Simulating it needs a Chainlink CRE account, so the simulation output and the `CreAttestor` deploy come next. Steps are in `cre/README.md`.
{% endhint %}

## Problem

The weakest trust assumption in Assay is the verifier. One verifier runs the grader on one machine and posts a grade. Readers can choose verifiers, but each grade still comes from a single party who could lie, cherry-pick runs or go offline.

## Why CRE

A CRE workflow runs on a decentralized oracle network. Every node runs the same steps on its own, the results go through consensus, and the DON writes the result onchain. "A verifier says host X passed" becomes "a quorum of independent nodes recomputed it". A multisig of Assay's own servers would still be Assay, and an optimistic dispute game needs long challenge windows and a bond.

## What the workflow does

1. Trigger: an EVM log trigger on `GradePosted` from `VerifierRegistry` on Monad testnet.
2. Each node fetches the evidence bundle over HTTP.
3. Each node checks `sha256(bundle) == evidence` from the event.
4. Each node recounts `passed` and `total` from the raw log and recomputes the 95% Wilson interval.
5. Consensus on the identical result.
6. The DON writes a report to `CreAttestor.onReport`, which stores it and emits `GradeAttested(verifier, model, hostKey, t, agree, passed, total)`.

## What `CreAttestor` checks

| Check | Error |
|---|---|
| Caller is the configured forwarder | `NotForwarder()` |
| Metadata is at least 64 bytes | `BadMetadata()` |
| Workflow owner matches, and workflow id matches if set | `UnauthorizedWorkflow()` |
| Report is exactly 288 bytes, counts and interval in range | `BadReport()` |
| `configure` runs once, from the owner, with non-zero addresses | `NotOwner()`, `AlreadyConfigured()`, `BadConfig()` |

`onReport` costs up to about 61,000 gas.

## How to try it

1. Run the contract tests: `cd contracts && forge test --match-contract CreAttestor -vv`.
2. When the workflow ships, `cre workflow simulate` output will be saved in `docs/evidence/`.

## Where else this shows up

| Place | Uses |
|---|---|
| [Contracts reference](../developers/contracts.md) | Full `CreAttestor` interface |
| [Indexer and GraphQL](../developers/indexer.md) | The `GradeAttestation` entity |
| [Verifiers and grades](../how-it-works/verifiers-and-grades.md) | The grades being re-checked |

{% hint style="warning" %}
The CRE forwarder is shared by every workflow on the network. That is why `CreAttestor` also pins reports to one workflow owner. Without that check, any workflow could write attestations.
{% endhint %}

Next: [Mera](mera.md)
