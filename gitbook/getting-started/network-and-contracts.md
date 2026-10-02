---
description: Chain details, contract addresses, deploy transactions and ERC-8004 ids for the live testnet deployment.
icon: network-wired
---

# Network and contracts

**Where:** `docs/deployments.md` in the repo, and the broadcast record in `contracts/broadcast/Deploy.s.sol/10143/`.

Every address on this page is live on Monad testnet. Both Assay contracts were deployed on 1 Oct 2026 and are verified on Sourcify with an exact match.

## Network

| Field | Value |
|---|---|
| Chain | Monad testnet |
| Chain id | `10143` |
| RPC | `https://testnet-rpc.monad.xyz` (alias `monad_testnet` in `foundry.toml`) |
| Explorer | [testnet.monadvision.com](https://testnet.monadvision.com) |
| P256VERIFY precompile | `0x0100` (EIP-7951) |
| Compiler | solc 0.8.30, `evm_version = "osaka"`, Foundry 1.7.1 |

## Assay contracts

| Contract | Address | Deploy tx | Block |
|---|---|---|---|
| ReceiptAnchor | [`0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24`](https://testnet.monadvision.com/address/0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24) | [`0x32d12f86…`](https://testnet.monadvision.com/tx/0x32d12f86ec3dca22d7b25ec33985eeda69f94e7299592728b16b2896715a1022) | 67461080 |
| VerifierRegistry | [`0x7755818dc08659D2A3A66FA3ddb1Ce636c145C91`](https://testnet.monadvision.com/address/0x7755818dc08659D2A3A66FA3ddb1Ce636c145C91) | [`0x246d2ef1…`](https://testnet.monadvision.com/tx/0x246d2ef1d317d9ef4dc21318ef16a60f50bc1e4818685058228669f0b48abfd8) | 67461086 |
| CreAttestor | Not deployed yet | | |

`ReceiptAnchor` was deployed with `requireUV = true`. Both contracts read `ownerOf` from the ERC-8004 IdentityRegistry below.

## ERC-8004 registries

| Registry | Address |
|---|---|
| IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

These are the official deployments from `erc-8004/erc-8004-contracts`.

## Agents

| Role | agentId | Owner | Registration tx |
|---|---|---|---|
| Reference host | 1962 | `0xF3CbD8aaf1f2350bFd8a3220Ab4E83FDd8fa18d9` | [`0x4f164f1d…`](https://testnet.monadvision.com/tx/0x4f164f1db133dd9fba6af4433cb2b5af9869afdf08e11044fb0b4281f55b8c97) (block 67269809) |

In receipts this host appears as `"agentId": "erc8004:10143:1962"`.

## Onchain activity so far

| What | Tx | Notes |
|---|---|---|
| `setHostKey(1962, …)` with a throwaway demo key | [`0x4ec112c6…`](https://testnet.monadvision.com/tx/0x4ec112c6017876122907af089417deed43ad01cb84a506fd6916aae94f8ba93c) (block 67273078) | To be replaced by the real host key |
| First anchor: 2 receipts, root `0x5594c31b…6e57` | [`0x663e126c…`](https://testnet.monadvision.com/tx/0x663e126c75016ee71ea7f3fc9a3f3daf291475ecf3c6a34c358e414db06a6c6e) (block 67273084) | Host signature checked by the P256 precompile |

Both demo receipts verify under agent 1962 and fail under any other agent id. The calls and results are in `docs/evidence/day3-anchor-verify.txt`.

## How to check an address yourself

1. Open the address on the explorer and confirm the Sourcify verification badge.
2. Read a value with `cast`, for example the anchor tag:

```bash
cast call 0x049A73755cA3508ef3Daa4752A3406f6e00CfB13 "ANCHOR_TAG()(bytes32)" \
  --rpc-url https://testnet-rpc.monad.xyz
```

3. Compare it with `cast keccak "assay-anchor/0"`. They must match.

## Where else this shows up

| Place | Uses |
|---|---|
| [Host API](../developers/host-api.md) | `ANCHOR_ADDRESS` and `HOST_AGENT_ID` in the host's environment |
| [Indexer and GraphQL](../developers/indexer.md) | Start blocks 67461080, 67461086 and 67269800 |
| [Contracts reference](../developers/contracts.md) | Every function on these addresses |

{% hint style="warning" %}
The deployed `ReceiptAnchor` predates `cosignK`. Passkey `cosign` works on this address today. Mera-style secp256k1 co-signatures need the next deployment, and this page will list the new address when it ships.
{% endhint %}

Next: [Receipts](../how-it-works/receipts.md)
