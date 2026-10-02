# Adopters

This page covers who would use Assay, what each kind of adopter would wire in, and why building it in-house doesn't work. The projects named below are public projects that fit each profile. Naming them describes how they could integrate. None of them is a partner today.

## Why not build it yourself

Three facts hold for every adopter below.

| Fact | Consequence |
|---|---|
| A host can't certify itself. | A grade only means something when someone other than the host produced it, against a reference the host doesn't control. Assay grades test each host against the lab's own endpoint and publish the raw logs. |
| A platform's grades stay on that platform. | A router that tests its own hosts helps its own traffic. The grade doesn't travel with the output, and nobody outside can recompute it. Assay grades are onchain, keyed by host identity, and any reader picks which verifiers to trust. |
| A receipt is only useful if the format is shared. | If every host signs a different format, every consumer needs a verifier per host. Assay receipts are JCS JSON signed as ES256 JWS, with keys at `/.well-known/jwks.json`. MonadGuard uses the same convention for its signed verdicts. |

## Inference marketplaces

Buyers pick among many hosts selling the same open-weight model. Labels for precision and context are self-reported, and the same weights score differently from one host to another. A signed response proves which node answered. It doesn't prove the node served the model it advertised.

What to wire in:

| Need | Call |
|---|---|
| Rank or filter sellers by measured quality | `VerifierRegistry.gradeOf(model, hostKey, trusted)`, or `gradeOf` and `gradeStatus` from the SDK |
| A host key that survives key rotation | `hostKeyForAgent(chainId, agentId)` for hosts with an ERC-8004 identity |
| Proof per response for buyers | Sellers return `X-Assay-Receipt`. Buyers check it with `verifyReceipt` |
| Per-host history and drift | The Envio indexer: `HostModelStats`, `DriftEvent`, `ModelLeaderboard` |

AntSeed's peers already sign responses with secp256k1 and EIP-191, and AntSeed says its signatures prove who served which bytes, not the model. An outside Assay verifier could supply the model side. Surplus documents that quantization, context truncation and sampling defaults are not measured yet, and lists quality scoring as planned. Assay grades cover that gap without a testing team of their own.

## Gateways and routers

A gateway that can't tell honest hosts from dishonest ones has two bad options. It can route blind, or it can delist every third-party host and lose cheaper capacity. Glama, an AI gateway, delisted its third-party providers because "some of them are obviously lying about their quantization".

What to wire in:

| Need | Call |
|---|---|
| Relist only hosts that pass | `gradeStatus(grade, { now, reference })` returns `pass`, `warn`, `unknown` or `fail` |
| Stop routing when a host gets worse | Subscribe to `DriftEvent` in the indexer |
| Pass proof through to users | Forward the host's `X-Assay-Receipt` header unchanged |

Glama could read grades for the models it serves and relist hosts whose grades pass, using verifiers it chooses.

## Agent frameworks and payment layers

An agent that pays for inference, or acts on a model's answer, has no machine-checkable reason to trust the host. A policy that limits spending can't express "only from hosts that pass".

What to wire in:

| Need | Call |
|---|---|
| Spend only on good hosts | One view call to `gradeOf(model, hostKey, trusted)` in the policy check, then `gradeStatus` |
| Keep proof of what the agent was told | `wrap(fetch)` on the agent's model calls. Store the receipt and salt |
| Tie the request to the agent's own key | `wrap(fetch, { cosigner })`, then `cosign` (passkey) or `cosignK` (secp256k1) |
| Pay once per receipt | Store `receiptHash` as spent in the paying contract (SPEC section 8) |

Mandate gives an agent a scoped, revocable mandate from a passkey. A mandate condition such as "only pay for inference from hosts graded pass by verifiers I trust" would be one `gradeOf` call. MonadGuard signs verdicts about tools as ES256 over JCS with keys in a JWKS, the same format as Assay receipts. One verifier library could check both, so an agent could require that its tool and its model host both pass before it acts.

## Open-weight labs

A lab's model is judged by how third-party hosts serve it. A bad quantization on one host becomes "the model is worse than claimed". Labs that run vendor verifiers can only cover the hosts they get around to testing.

What to wire in:

| Need | Call |
|---|---|
| Neutral coverage of every host | `harness/assay_probe.py` with the lab's own API as `--reference-base-url` |
| Publish results others can recompute | `harness/export_grade.py`, then `postGrade` with the evidence hash |
| Grade its own API as the reference | `hostKeyForDirect("<api host>")` |

Labs keep control of the reference. Assay supplies the harness, the registry and the right of reply: a host graded below the reference gets its logs and 7 days to respond before anything is posted.

## Publishers

Text produced by a model loses its origin the moment it is copied. A publisher can't show which host and model produced a passage, or that it wasn't edited after generation, without publishing the prompt.

What to wire in:

| Need | Call |
|---|---|
| Keep a receipt per generated passage | `wrap(fetch)`. Store the receipt and the salt |
| Show origin to a reader | Share the receipt and the salt. The reader runs `verifyReceipt` with the output, or uses the web app's Verify tab |
| Keep the prompt private | Reveal only the salt and output. `outputCommit` passes and `promptCommit` stays skipped |
| Show who asked | A passkey co-signature that matches `req.cosigner` |

The receipt keeps working after the text moves, because the proof is the receipt, the anchor and the salt, not the page it was published on.
