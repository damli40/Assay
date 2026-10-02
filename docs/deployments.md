# Deployments

## Monad testnet (chain 10143)

Current deployment, 3 Oct 2026, with Foundry 1.7.1, solc 0.8.30 and `evm_version = "osaka"`. All three contracts are verified on Sourcify with an exact match. This version adds `cosignK` (secp256k1 requester co-signatures) to ReceiptAnchor. `CreAttestor` is owned by the `assay-host` address. Its `configure(forwarder, workflowOwner, workflowId)` call waits for the CRE workflow deploy, so it accepts no reports yet.

| Contract | Address | Deploy tx | Block |
|---|---|---|---|
| ReceiptAnchor | [`0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24`](https://testnet.monadvision.com/address/0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24) | [`0x32d12f86…`](https://testnet.monadvision.com/tx/0x32d12f86ec3dca22d7b25ec33985eeda69f94e7299592728b16b2896715a1022) | 67461080 |
| VerifierRegistry | [`0x7755818dc08659D2A3A66FA3ddb1Ce636c145C91`](https://testnet.monadvision.com/address/0x7755818dc08659D2A3A66FA3ddb1Ce636c145C91) | [`0x246d2ef1…`](https://testnet.monadvision.com/tx/0x246d2ef1d317d9ef4dc21318ef16a60f50bc1e4818685058228669f0b48abfd8) | 67461086 |
| CreAttestor | [`0xB4A1CB9e40aDa44570Ae790430C23876d460deDC`](https://testnet.monadvision.com/address/0xB4A1CB9e40aDa44570Ae790430C23876d460deDC) | [`0x0d2dc7b2…`](https://testnet.monadvision.com/tx/0x0d2dc7b2fc51c718226a28bc2b0027a94d74409b1060f47b795d9582ab6bb00a) | 67462996 |

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
| Verifier | 1981 | `0x4BaC2Be288B5931886EeC4c555895CE6BcAB19e7` | [`0xfb3d22c2…`](https://testnet.monadvision.com/tx/0xfb3d22c27fb265d3ec4b8582d8a5ada650ea506c81b54e1cfd4ece9d1366f210) (block 67575374) | [verifier.json](agents/verifier.json) |

The full registration receipts are in [evidence/host-register.json](evidence/host-register.json) and [evidence/verifier-register.json](evidence/verifier-register.json). The verifier is a separate wallet because ERC-8004 doesn't let an agent's owner give feedback to its own agent.

## Onchain activity

| What | Tx | Notes |
|---|---|---|
| `registerVerifier(1981)` on the 3 Oct VerifierRegistry | [`0x752c6fe5…`](https://testnet.monadvision.com/tx/0x752c6fe566c60f390a79c449c812afc1fcd8b6802b1877da7bdc6231da52d178) (block 67575710) | Agent 1981 can now post grades |
| `setHostKey(1962, …)` with the real host key on the 3 Oct ReceiptAnchor, key hash `0x6c73fb3e…a68e` | [`0xcfd45e43…`](https://testnet.monadvision.com/tx/0xcfd45e4304e7de3c0337eb83288d657e978efc2a0df614c74cfb1a9adcc7b8b4) (block 67464463) | The host's ES256 key (kid `2Jc6WJSj…qg0`). The private key stays in the host's gitignored `.keys/` folder |
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
