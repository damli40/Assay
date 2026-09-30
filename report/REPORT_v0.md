# Who's actually serving your model?

Open-weight hosting, September 2026. Report v0, by Rudransh (Assay).

## Summary

Many listings don't say what precision they run at. On 26 Sep 2026, OpenRouter's public API listed 735 distinct endpoints for 140 open-weight models from 56 providers. For 289 of them (39%) the precision field reads `unknown`, and 107 (15%) declare a 4-bit format.

Popular models come in many variants. GLM-5.3 has 37 endpoints, of which 16 state no precision and 8 declare 4-bit. Output prices run from $1.19 to $8.80 per million tokens, and advertised context from 262K to 1.31M tokens.

The labels don't predict quality either. Independent teams measured the same weights scoring 90% at one host and 75% at another, and in one comparison a provider declaring fp4 beat one declaring fp8.

The checks that do exist stay where they were made. Each covers one platform, one lab's models or one point in time, and none of them travels with the output.

## 1. How this was measured

We read `GET https://openrouter.ai/api/v1/models/{model}/endpoints` for every open-weight model OpenRouter lists, from 11 author namespaces (DeepSeek, Moonshot, Z.ai, Qwen, OpenAI gpt-oss, Meta, Mistral, MiniMax, NVIDIA, Google Gemma, THUDM), on 26 Sep 2026 at 17:25 UTC. The call is public and needs no key.

Every field in sections 2 and 3 is what the provider reports to OpenRouter. None of it was tested. The raw file ships with this report: [`data/openrouter_endpoints_2026-09-26.json`](data/openrouter_endpoints_2026-09-26.json).

Some endpoint tags appear twice in the listing (746 listings, 735 distinct). Counts below use distinct endpoints.

## 2. What hosts say about precision

| Declared precision | Endpoints | Share |
|---|---|---|
| fp8 | 285 | 38.8% |
| not stated (`unknown`) | 289 | 39.3% |
| fp4 | 81 | 11.0% |
| bf16 | 51 | 6.9% |
| int4 | 17 | 2.3% |
| nvfp4 | 5 | 0.7% |
| mxfp4 | 4 | 0.5% |
| fp16 | 3 | 0.4% |

For 14 of the 56 providers, OpenRouter's API lists no precision on any endpoint: Google (17), DigitalOcean (15), Fireworks (14), Together (12), Wafer (9), Amazon Bedrock (8), Friendli (7), Reka (7), Groq (6), Mara (5), DeepSeek (2), Azure (2), PrimeIntellect (1), Cohere (1).

A missing precision field is not evidence of a problem. It only means a buyer can't tell from the listing.

## 3. Same model, many versions

| Model | Endpoints | Precision not stated | Declares 4-bit | Output $/M (min to max) | Advertised context (min to max) |
|---|---|---|---|---|---|
| z-ai/glm-5.3 | 37 | 16 | 8 | $1.19 to $8.80 (7.4x) | 262K to 1.31M |
| z-ai/glm-5.2 | 30 | 9 | 8 | $1.54 to $8.00 (5.2x) | 131K to 1.05M |
| deepseek/deepseek-v4-flash-0731 | 30 | 11 | 5 | $0.13 to $1.32 (10.0x) | 262K to 1.31M |
| openai/gpt-oss-120b | 23 | 9 | 5 | $0.17 to $0.95 (5.6x) | 128K to 131K |
| deepseek/deepseek-v4-pro-0813 | 22 | 11 | 2 | $0.75 to $4.95 (6.6x) | 1.00M to 1.05M |
| moonshotai/kimi-k3 | 19 | 9 | 7 | $9.04 to $22.50 (2.5x) | 1.05M (all) |
| moonshotai/kimi-k2.6 | 19 | 5 | 10 | $1.72 to $4.60 (2.7x) | 256K to 262K |
| qwen/qwen3.8-27b | 16 | 7 | 1 | $1.80 to $4.40 (2.4x) | 262K to 1.00M |

A 4-bit label doesn't automatically mean a worse model. Some releases are trained to run at low precision, and the next section shows labels failing to predict scores in both directions. That's why the next step is measurement, not labels.

Only 311 of the 746 listings advertise logprobs. Most black-box checks therefore have to work from the output text alone.

## 4. What others have measured

| Who | Model | Finding | Source |
|---|---|---|---|
| Olly (production app, 18M messages) | DeepSeek V4 Flash | 90% GPQA and 81% TAU on DeepSeek's own API. 75% and 58% on DigitalOcean. | mmoustafa.com/blog/so-you-want-to-use-openrouter (7 Sep 2026) |
| Olly follow-up coverage | same | A provider declaring fp4 scored 89.1% on GPQA. A different provider declaring fp8 scored 70.5%. | Pinggy and umesh-malik.com rewrites (Sep 2026) |
| Cline | GLM-5.2 | 74.2% on CoreWeave, 61.8% on OpenRouter's default routing. Cline now onboards a provider only if "its eval score is on par with the others". | cline.bot/blog/open-sourcing-evals-for-open-weight-agents (18 Aug 2026) |
| Moonshot K2 Vendor Verifier | Kimi K2 Thinking | Tool-call schema accuracy from 100% (official API, Fireworks) down to 86.91% (DeepInfra) | github.com/MoonshotAI/K2-Vendor-Verifier |
| OpenRouter Auto Exacto | GLM-5, GLM-4.7 | Routing to better hosts cut tool-call error rates by 88% and 80%, from about 8% to about 1% | openrouter.ai/blog/announcements/auto-exacto (12 Mar 2026) |
| Metaculus | 33 open-weight bots | Pinned each bot to specific endpoints because "the model behind an open-weight bot can change from run to run" | github.com/Metaculus/forecasting-tools/pull/351 (25 Sep 2026) |
| Glama (AI gateway) | all third-party hosts | "we had to delist all third-party providers because some of them are obviously lying about their quantization" | news.ycombinator.com/item?id=47844798 (21 Apr 2026) |
| CISPA | 17 unofficial resale APIs | Identity checks failed in 45.83% of fingerprint tests, with performance gaps up to 47.21% | arXiv 2603.01919 (Mar 2026) |

## 5. What's missing

Each existing check stops somewhere.

OpenRouter grades hosts continuously, but only for traffic that goes through OpenRouter.

Moonshot, MiniMax and OpenAI publish verifiers, each for its own models. Moonshot's K3 table covers 7 vendors, while OpenRouter lists 17 providers for kimi-k3.

Artificial Analysis grades endpoints against the official weights, but as dated snapshots, and it didn't list GLM-5.3 when we checked.

Marketplaces that sell inference from strangers say they don't measure this yet. Surplus lists quantization as "not measured", and AntSeed says its signed responses "prove who served which bytes", not which model ran.

None of these results travel with the output, so someone who receives a piece of AI-generated text has no way to check where it came from.

## 6. What comes next

Report v1, due by 11 Oct, will grade every GLM-5.3 endpoint against Z.ai's own endpoint using the open harness in `harness/assay_probe.py`. It will test tool-call correctness, parameter handling, context length and model identity from the outside, and it will publish 95% confidence intervals with the raw logs. Any endpoint that scores below the reference gets its logs and 7 days to respond before publication.

Assay receipts give every response a certificate of origin. A receipt carries the host's P-256 signature, an optional passkey co-signature from the requester, and salted hashes of the prompt and output anchored on Monad. Each receipt links to the host's latest grade from open verifiers, and the format is described in `SPEC.md`.

## Limits of this report

Everything in sections 2 and 3 is what providers report to OpenRouter, captured at one moment, and listings change daily.

Section 4 quotes other people's results without re-running them. The sources are listed so you can check them yourself.

Nothing here claims that a named provider serves a degraded model. The report shows what a buyer can and can't see today.
