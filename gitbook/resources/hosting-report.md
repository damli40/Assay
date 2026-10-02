---
description: Report v0 on who serves open-weight models, what they declare, and why the checks don't travel with the output.
icon: chart-column
---

# Hosting report

**Where:** `report/REPORT_v0.md` and `report/index.html` in the repo. The raw data is `report/data/openrouter_endpoints_2026-09-26.json`.

Report v0 reads what hosts tell OpenRouter about the open-weight models they serve. Nothing in sections 2 and 3 of the report was tested. It shows what a buyer can and can't see from a listing.

## How it was measured

| Field | Value |
|---|---|
| Source | `GET https://openrouter.ai/api/v1/models/{model}/endpoints`, public, no key |
| Captured | 26 Sep 2026, 17:25 UTC |
| Scope | 11 author namespaces, 140 open-weight models, 56 providers |
| Listings | 746, of which 735 distinct endpoints |

## Declared precision

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

## Same model, many versions

| Model | Endpoints | Precision not stated | Declares 4-bit | Output $/M |
|---|---|---|---|---|
| z-ai/glm-5.3 | 37 | 16 | 8 | $1.19 to $8.80 |
| z-ai/glm-5.2 | 30 | 9 | 8 | $1.54 to $8.00 |
| deepseek/deepseek-v4-flash-0731 | 30 | 11 | 5 | $0.13 to $1.32 |
| openai/gpt-oss-120b | 23 | 9 | 5 | $0.17 to $0.95 |
| deepseek/deepseek-v4-pro-0813 | 22 | 11 | 2 | $0.75 to $4.95 |
| moonshotai/kimi-k3 | 19 | 9 | 7 | $9.04 to $22.50 |
| moonshotai/kimi-k2.6 | 19 | 5 | 10 | $1.72 to $4.60 |
| qwen/qwen3.8-27b | 16 | 7 | 1 | $1.80 to $4.40 |

Only 311 of the 746 listings advertise logprobs, so most outside checks have to work from the output text alone.

## What others measured

| Who | Finding |
|---|---|
| Olly | DeepSeek V4 Flash at 90% GPQA on DeepSeek's API and 75% on DigitalOcean |
| Cline | GLM-5.2 at 74.2% on CoreWeave and 61.8% on OpenRouter's default routing |
| Moonshot K2 Vendor Verifier | Tool-call schema accuracy from 100% down to 86.91% across vendors |
| Glama | Delisted every third-party host because "some of them are obviously lying about their quantization" |

The report lists each source with its date so you can check it.

## How to read it

1. A missing precision field is not evidence of a problem. It only means a buyer can't tell from the listing.
2. A 4-bit label does not automatically mean a worse model. One comparison found a provider declaring fp4 beating one declaring fp8.
3. That is why the next step is measurement. Report v1 will grade every GLM-5.3 endpoint against Z.ai's own endpoint with `harness/assay_probe.py`, with 95% intervals and raw logs.

## Where else this shows up

| Place | What it covers |
|---|---|
| [Welcome to Assay](../README.md) | The headline numbers |
| [Verifiers and grades](../how-it-works/verifiers-and-grades.md) | How measured grades go onchain |

{% hint style="warning" %}
The report names no provider as serving a degraded model. Any endpoint that scores below the reference in report v1 gets its logs and 7 days to respond before publication.
{% endhint %}

Next: [FAQ](faq.md)
