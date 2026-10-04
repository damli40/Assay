# Assay indexer

An Envio HyperIndex project for Monad testnet (chain 10143). It joins Assay's two contracts with the ERC-8004 identity registry and a Chainlink CRE attestor. Handlers compute the derived entities (drift, leaderboards, activity, key history) at index time, so the GraphQL API only reads.

This folder is a standalone project. It is not part of the pnpm workspace and has its own lockfile.

## Contracts

| Contract | Address | Start block | Events |
|---|---|---|---|
| ReceiptAnchor | `0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24` | 67461080 | `HostKeySet`, `Anchored`, `Cosigned`, `CosignedK` |
| VerifierRegistry | `0x7755818dc08659D2A3A66FA3ddb1Ce636c145C91` | 67461086 | `VerifierRegistered`, `GradePosted` |
| ERC-8004 IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | 67269800 | `Registered` |
| CreAttestor | `0xB4A1CB9e40aDa44570Ae790430C23876d460deDC` | 67462996 | `GradeAttested` |
| ERC-8004 ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | 67461080 | `NewFeedback`, `FeedbackRevoked`, `ResponseAppended` |

The ReputationRegistry events are taken from the official ABI in erc-8004/erc-8004-contracts.

## Entities

Every id starts with the chain id (`10143-...`), so a second chain can be added without migrating ids.

| Entity | Id | Answers |
|---|---|---|
| `Agent` | `10143-<agentId>` | Who is this ERC-8004 agent? Owner, URI, card name, description, image and services, current host key, lifetime counters. |
| `HostKey` | `10143-<agentId>-<keyHash>` | Which P-256 key does a host sign with, is it still active, and how many anchors and receipts did it sign? |
| `KeyRotation` | `10143-<agentId>-<block>-<logIndex>` | When did a host change keys, from which key to which, and how many anchors did the old key sign? |
| `Anchor` | `10143-<agentId>-<root>` | Was this Merkle root anchored, by which host and key, with how many receipts and co-signatures? |
| `Cosign` | `10143-<receiptHash>-<requester>` | Who co-signed this receipt? `kind` is `P256` (passkey key hash) or `K` (secp256k1 signer address). |
| `HostActivity` | `10143-<agentId>-<YYYY-MM-DD>` | How many anchors, receipts and co-signatures did a host have on a UTC day? |
| `Verifier` | `10143-<address>` | Which ERC-8004 agent does a verifier address belong to, and how many grades has it posted? |
| `Grade` | `10143-<verifier>-<model>-<hostKey>-<t>` | One posted grade with counts, interval, evidence hash and any CRE attestations. |
| `HostModelStats` | `10143-<verifier>-<model>-<hostKey>` | Latest grade, grade count, pass rate over all grades, drift count and leaderboard rank for one host, model and verifier. |
| `DriftEvent` | same as the new grade | Did a host get worse? Written when a new grade's `ciHighBps` is below the previous grade's `ciLowBps`. |
| `ModelLeaderboard` | `10143-<verifier>-<model>` | Which host leads a model for this verifier? Entries are `HostModelStats` ranked by latest `ciLowBps`. |
| `GradeAttestation` | `10143-<attestor>-<verifier>-<model>-<hostKey>-<t>` | Did the Chainlink DON agree with a posted grade? |
| `Feedback` | `10143-<agentId>-<client>-<feedbackIndex>` | ERC-8004 feedback about an agent. `receiptBacked` is true when the sender co-signed, with `cosignK`, the receipt named in `feedbackHash`. `hostResponseURI` is the agent owner's reply. |

A few rules the handlers follow:

- Leaderboards are per verifier. Readers choose which verifiers to trust, so there is no global ranking.
- Ranking order: higher `ciLowBps`, then higher `ciHighBps`, then `hostKey`.
- `passRateBps` is the sum of `passed` over the sum of `total` across every grade for that host, model and verifier.
- Drift needs the whole new interval below the old one, so an overlapping drop does not count.
- Feedback counts on `Agent` (`receiptBackedFeedbackCount`, `receiptBackedNegativeCount`) only include receipt-backed feedback, and revoked feedback is taken out again.
- Only a reply from the agent's owner is stored as `hostResponseURI`. Anyone can append a response in ERC-8004, so other replies are ignored.

## Agent cards

The `agentURI` card is loaded through the Effect API (`src/agentCard.ts`), only for agents that set a host key or register as a verifier.

| URI | Behaviour |
|---|---|
| `data:` | Decoded locally, no network call. |
| `https://` | Fetched, 10 s timeout, 64 KiB limit, 5 calls per second. |
| `ipfs://` | Fetched through `https://ipfs.io/ipfs/`. |
| anything else | Skipped, `cardStatus = UNSUPPORTED`. |

A failed fetch sets `cardStatus = ERROR` and is not cached, and indexing carries on. The next key change or verifier registration for that agent retries it.

## Example queries

Host trust check. Is this host good for this model, according to a verifier I trust?

```graphql
query HostTrust {
  HostModelStats(where: {id: {_eq: "10143-<verifier>-<model>-<hostKey>"}}) {
    rank
    latestCiLowBps
    latestCiHighBps
    gradeCount
    passRateBps
    driftCount
    latest { passed total t evidence attestations { agree attestor } }
    leaderboard { hostCount leaderHostKey leaderCiLowBps }
  }
}
```

Drift feed:

```graphql
query DriftFeed {
  DriftEvent(order_by: {timestamp: desc}, limit: 20) {
    model
    hostKey
    previousCiLowBps
    ciHighBps
    dropBps
    timestamp
    verifier { address agentId }
    grade { evidence txHash }
  }
}
```

Leaderboard for one model and verifier:

```graphql
query Leaderboard {
  HostModelStats(
    where: {leaderboard_id: {_eq: "10143-<verifier>-<model>"}}
    order_by: {rank: asc}
  ) {
    rank
    hostKey
    latestCiLowBps
    latestCiHighBps
    gradeCount
  }
}
```

Receipts anchored per host per day:

```graphql
query Activity {
  HostActivity(where: {agent_id: {_eq: "10143-1962"}}, order_by: {day: desc}, limit: 30) {
    day
    anchors
    receipts
    cosigns
  }
}
```

Agent profile with key history:

```graphql
query AgentProfile {
  Agent(where: {id: {_eq: "10143-1962"}}) {
    name
    description
    services
    owner
    cardStatus
    anchorCount
    receiptCount
    cosignCount
    currentKey { keyHash setBlock }
    rotations(order_by: {block: asc}) {
      fromKey { keyHash }
      toKey { keyHash }
      anchorsUnderFromKey
      txHash
    }
    anchors(order_by: {block: desc}, limit: 5) { root count cosignCount hostKey { keyHash } txHash }
  }
}
```

## Run locally

Needs Node 22 or newer. Use `corepack pnpm` inside this folder.

```bash
cd indexer
corepack pnpm install
corepack pnpm codegen          # writes .envio/types.d.ts from config.yaml and schema.graphql
corepack pnpm exec tsc --noEmit
corepack pnpm test             # handler tests with simulated events, no network
```

Running against the chain also needs Docker and an Envio API token (HyperSync requires one):

```bash
cp .env.example .env           # set ENVIO_API_TOKEN
corepack pnpm dev              # GraphQL at http://localhost:8080, local password "testing"
```

| Variable | Needed for | Notes |
|---|---|---|
| `ENVIO_API_TOKEN` | `dev`, hosted deploy | From envio.dev/app/api-tokens. |
| `ENVIO_CRE_ATTESTOR_ADDRESS` | CRE attestations | Optional. Defaults to the zero address. |

## Deploy to Envio Cloud

Assay runs on the hosted development plan, which is free.

1. Install the GitHub app `envio-deployments` on the Assay repo.
2. Push the code to an `envio` branch (the default deploy branch).
3. Log in and add the indexer:

```bash
pnpx envio-cloud login
pnpx envio-cloud indexer add --name assay-indexer --repo Assay --branch envio --root-dir indexer --yes
```

4. Set `ENVIO_CRE_ATTESTOR_ADDRESS` with `envio-cloud indexer env set` once CreAttestor is deployed. Env changes apply on the next deployment.
5. Check the deployment and get the GraphQL URL:

```bash
pnpx envio-cloud deployment status assay-indexer <commit> -o json
pnpx envio-cloud deployment endpoint assay-indexer <commit>
```

Open question: the CLI has `--root-dir` for a subfolder, but we have not run a hosted build from `indexer/` yet. This folder has its own `pnpm-workspace.yaml` so `pnpm install` here ignores the root workspace. If the hosted build still fails, push an `envio` branch whose root is this folder (`git subtree split --prefix indexer`).

## Not indexed yet

| Item | Why |
|---|---|
| Agent URI updates | Only `Registered` is indexed. |

## HyperSync analytics

`scripts/hypersync_stats.py` reads every `Anchored` event and its transaction's gas straight from HyperSync, with no RPC and no indexer, and reports per host: batches, receipts, gas per batch, MON spent and MON per receipt. Monad bills the gas limit, so the gas shown is what was paid.

```bash
ENVIO_API_TOKEN=... python3 indexer/scripts/hypersync_stats.py          # markdown table
ENVIO_API_TOKEN=... python3 indexer/scripts/hypersync_stats.py --json   # raw numbers
python3 -m unittest discover indexer/scripts                            # test
```
