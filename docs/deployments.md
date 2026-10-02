# Deployments

## Monad testnet (chain 10143)

Current deployment, 3 Oct 2026, with Foundry 1.7.1, solc 0.8.30 and `evm_version = "osaka"`. Both contracts are verified on Sourcify with an exact match. This version adds `cosignK` (secp256k1 requester co-signatures) to ReceiptAnchor.

| Contract | Address | Deploy tx | Block |
|---|---|---|---|
| ReceiptAnchor | [`0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24`](https://testnet.monadvision.com/address/0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24) | [`0x32d12f86…`](https://testnet.monadvision.com/tx/0x32d12f86ec3dca22d7b25ec33985eeda69f94e7299592728b16b2896715a1022) | 67461080 |
| VerifierRegistry | [`0x7755818dc08659D2A3A66FA3ddb1Ce636c145C91`](https://testnet.monadvision.com/address/0x7755818dc08659D2A3A66FA3ddb1Ce636c145C91) | [`0x246d2ef1…`](https://testnet.monadvision.com/tx/0x246d2ef1d317d9ef4dc21318ef16a60f50bc1e4818685058228669f0b48abfd8) | 67461086 |
| CreAttestor | Not deployed yet | | |

ReceiptAnchor was deployed with `requireUV = true`. Both contracts point at the ERC-8004 IdentityRegistry at `0x8004A818BFB912233c491871b3d84c89A494BD9e`.

### Earlier deployment (1 Oct 2026)

The first version, without `cosignK`. The first anchor and the evidence files from 1 Oct point at these addresses.

| Contract | Address | Deploy tx | Block |
|---|---|---|---|
| ReceiptAnchor | [`0x049A73755cA3508ef3Daa4752A3406f6e00CfB13`](https://testnet.monadvision.com/address/0x049A73755cA3508ef3Daa4752A3406f6e00CfB13) | [`0x663de8f9…`](https://testnet.monadvision.com/tx/0x663de8f94888355de6baf5cba9a5c4b10af5f02ddebc9e9a878b638430fa97b4) | 67269630 |
| VerifierRegistry | [`0x0C8603041E7d425c4DCa041680C7AF4581dDa9a1`](https://testnet.monadvision.com/address/0x0C8603041E7d425c4DCa041680C7AF4581dDa9a1) | [`0x835b8d6d…`](https://testnet.monadvision.com/tx/0x835b8d6d0039a3b383f1cd9d589727e3ac6a14a1b413217ad65cd2049ca8acb9) | 67269635 |

## ERC-8004 identities

| Role | agentId | Owner | Registration tx | Agent card |
|---|---|---|---|---|
| Reference host | 1962 | `0xF3CbD8aaf1f2350bFd8a3220Ab4E83FDd8fa18d9` | [`0x4f164f1d…`](https://testnet.monadvision.com/tx/0x4f164f1db133dd9fba6af4433cb2b5af9869afdf08e11044fb0b4281f55b8c97) (block 67269809) | [host.json](agents/host.json) |

The full registration receipt is in [evidence/host-register.json](evidence/host-register.json).

## Onchain activity

| What | Tx | Notes |
|---|---|---|
| `setHostKey(1962, …)` with a throwaway demo key, on the 1 Oct ReceiptAnchor | [`0x4ec112c6…`](https://testnet.monadvision.com/tx/0x4ec112c6017876122907af089417deed43ad01cb84a506fd6916aae94f8ba93c) (block 67273078) | Replaced by the real host key on Day 5 |
| First anchor (1 Oct ReceiptAnchor): 2-receipt demo batch, root `0x5594c31b…6e57` | [`0x663e126c…`](https://testnet.monadvision.com/tx/0x663e126c75016ee71ea7f3fc9a3f3daf291475ecf3c6a34c358e414db06a6c6e) (block 67273084) | Host signature checked by the P256 precompile in a real transaction |

Both demo receipts verify onchain under agent 1962 and fail under any other agent id. The calls are in [evidence/day3-anchor-verify.txt](evidence/day3-anchor-verify.txt).

## Redeploying

Testnet has been reset before (16 Dec 2025), so the deploy is scripted and repeatable:

```bash
cd contracts
export IDENTITY_REGISTRY=0x8004A818BFB912233c491871b3d84c89A494BD9e
forge script script/Deploy.s.sol --rpc-url monad_testnet --account assay-host \
  --sender $(cast wallet address --account assay-host) --broadcast --gas-estimate-multiplier 120
```

Always pass `--sender` with `--account`: without it, forge simulates the script as a different address, and any call that checks `msg.sender` (such as `setHostKey`) reverts before anything is broadcast.

The broadcast record for this deployment is in `contracts/broadcast/Deploy.s.sol/10143/`.
