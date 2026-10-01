# Assay

A certificate of origin for every AI response.

## The problem

When you call an open-weight model like GLM-5.3 through someone else's host, the text comes back with no proof of where it came from.

The hosts don't all serve the same thing. On 26 Sep 2026, OpenRouter's API listed 37 distinct endpoints for GLM-5.3. Sixteen of them didn't state their precision, and eight declared 4-bit. Output prices ranged from $1.19 to $8.80 per million tokens, and advertised context went from 262K to 1.31M tokens.

The same weights also score differently depending on who serves them. Olly measured DeepSeek V4 Flash at 90% on GPQA through DeepSeek's own API and at 75% on DigitalOcean. Cline measured GLM-5.2 at 74.2% on CoreWeave and 61.8% on OpenRouter's default routing. Glama, an AI gateway, delisted every third-party host because "some of them are obviously lying about their quantization".

The checks that exist today stay inside the place that made them. OpenRouter grades hosts for OpenRouter traffic, and Moonshot and MiniMax check hosts of their own models. None of it travels with the output.

## What Assay does

Every response gets a receipt. The host signs it with a P-256 key (or secp256k1 for AntSeed-style hosts), and the person who asked can co-sign it with a passkey. Monad checks both signatures onchain through its P256 precompile. Only salted hashes of the prompt and output go onchain, so you can later prove where an output came from without showing the prompt.

Anyone can register as a verifier with an ERC-8004 identity. Verifiers test hosts against the lab's own endpoint and publish grades with confidence intervals and the raw logs behind them. Apps decide which verifiers they trust.

An Envio indexer serves grade history and drift, so a gateway, marketplace or agent can check a host with a single call.

The full format is in [SPEC.md](SPEC.md).

## Who it's for

Agents and apps that buy inference from hosts they don't control can attach receipts and check grades before they pay. Marketplaces and gateways like AntSeed, Surplus and Glama can route on grades without building their own testing team. Open-weight labs get neutral coverage of every host, including the ones they never got around to testing. And anyone publishing AI output gets a receipt that still works after the text is copied somewhere else.

## Status (30 Sep 2026)

| Piece | State |
|---|---|
| Grader (`harness/assay_probe.py`) | Works |
| Report v0 | Published in [report/](report/REPORT_v0.md) |
| P256 precompile tests (`0x0100`, EIP-7951) | 6 passing |
| WebAuthn co-sign tests (OpenZeppelin 5.7.0) | 12 passing |
| Precompile check on Monad testnet | Passed, see [evidence](docs/evidence/day1-precompile-testnet.txt) |
| ReceiptAnchor (host keys, anchoring, Merkle proofs, passkey co-sign) | 35 tests passing, including Node-generated signatures and proofs |
| VerifierRegistry and testnet deploy | In progress |
| `@assay/receipts` SDK and reference host | Planned |
| Envio indexer and verify page | Planned |

## Repo layout

```
contracts/   Foundry: ReceiptAnchor, VerifierRegistry, tests (OpenZeppelin P256 and WebAuthn)
sdk/         @assay/receipts: commit, cosign, verify, wrap(fetch)
host/        @assay/host: OpenAI-compatible proxy that signs receipts
harness/     assay_probe.py, the grader
indexer/     Envio HyperIndex: anchors, grades, drift
web/         verify page: paste an output and its receipt to see where it came from
report/      open-weight hosting report
docs/        deployments, quickstart, threat model, evidence
```

## Try the grader

The dry run needs no API key and prints the cost estimate before you spend anything.

```
cd harness
python3 assay_probe.py --model z-ai/glm-5.3 --dry-run
export OPENROUTER_API_KEY=sk-or-...
python3 assay_probe.py --model z-ai/glm-5.3 --reference z-ai --repeats 10
```

## Develop

You need Node 22 or newer, pnpm (`corepack enable`) and Foundry 1.7 or newer.

```
git clone --recurse-submodules git@github.com:trudransh/Assay.git
cd Assay/contracts && forge test -vv
```

## License

MIT
