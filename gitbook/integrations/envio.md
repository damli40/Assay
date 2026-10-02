---
description: Why Assay's read layer runs on Envio HyperIndex, what the handlers compute, and how to run or deploy it.
icon: magnifying-glass-chart
---

# Envio

**Where:** `indexer/` (Envio HyperIndex for `monad-testnet`). The entity reference is on [Indexer and GraphQL](../developers/indexer.md).

Envio is Assay's read layer. Every trust question an app asks, like which key signed this batch or whether a host is drifting, is answered from entities the handlers compute at index time.

## Problem

Assay's data is spread across events in its own contracts and the ERC-8004 registry, and it only means something when joined. A grade is useless without the host's identity, and an anchor is useless without the key that signed it. Answering "can I trust host X for model Y right now?" from raw RPC means scanning every log on every request.

## Why Envio

| Need | What HyperIndex gives |
|---|---|
| Several contracts in one place | Typed handlers over many contracts and chains in one `config.yaml` |
| Fast backfill | HyperSync, much faster than RPC log scans |
| Reorg safety | Handled by the framework, so handlers hold no rollback logic |
| A query API | GraphQL out of the box |
| External data | The Effect API, used here to load ERC-8004 agent cards |

## What we built

| Piece | Detail |
|---|---|
| Sources | ReceiptAnchor, VerifierRegistry, ERC-8004 IdentityRegistry and CreAttestor |
| 12 entities | Including `HostModelStats`, `DriftEvent`, `ModelLeaderboard`, `KeyRotation` and `HostActivity` |
| Derived at index time | Drift, per-verifier leaderboards, daily activity, key history |
| Agent cards | Fetched from `agentURI` through the Effect API, with timeouts and size limits |
| Chain-prefixed ids | `10143-…`, so a second chain is a config change and not a migration |
| Handler tests | Simulated events, no network |

## How to try it

1. `cd indexer && corepack pnpm install && corepack pnpm codegen && corepack pnpm test`
2. With Docker running and `ENVIO_API_TOKEN` set: `corepack pnpm dev`, then open `http://localhost:8080`.
3. Paste the "Activity" query from [Indexer and GraphQL](../developers/indexer.md).

To deploy on Envio Cloud's free development plan, install the `envio-deployments` GitHub app on the repo, push an `envio` branch, and add the indexer with `pnpx envio-cloud indexer add --name assay-indexer --repo Assay --branch envio --root-dir indexer --yes`.

## Where else this shows up

| Place | Uses |
|---|---|
| [Web app](../developers/web-app.md) | Grade history and drift |
| [Verifiers and grades](../how-it-works/verifiers-and-grades.md) | What a drift event means |

{% hint style="warning" %}
Envio Cloud has not built from the `indexer/` subfolder yet. If the hosted build fails, push an `envio` branch whose root is that folder (`git subtree split --prefix indexer`).
{% endhint %}

Next: [Chainlink CRE](chainlink-cre.md)
