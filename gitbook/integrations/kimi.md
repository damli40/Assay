---
description: The planned trust agent that reads grades and receipts with tool calls and answers in your language.
icon: robot
---

# Kimi

**Where:** planned. The agent will call the indexer's GraphQL API, SDK `verifyReceipt` and ERC-8004 agent cards.

{% hint style="info" %}
Planned. Nothing on this page is built yet. It describes the design so you know what to expect.
{% endhint %}

## Problem

Grades are numbers: pass counts, confidence intervals and drift events. Someone asking "should I send this request to host X?" needs a judgment with reasons, and so does a reader of a receipt who doesn't read English.

## Why Kimi

Kimi is built for tool use and handles many languages. Moonshot already runs a vendor verifier for hosts of its own models, so its models come from a lab that cares about this exact problem.

## What the agent will do

| Tool | Source |
|---|---|
| `get_grade` | Envio GraphQL (`HostModelStats`, `DriftEvent`) |
| `verify_receipt` | SDK `verifyReceipt` |
| `get_host_card` | The host's ERC-8004 agent card |

1. You give it a receipt or a host name.
2. It calls the tools above.
3. It returns a verdict with links to the evidence, in your language.
4. The agent's own answer is served through an Assay host, so its advice carries a receipt too.

The hosting report also plans to grade Kimi K3's 19 OpenRouter endpoints against Moonshot's own API.

## Where else this shows up

| Place | What it covers |
|---|---|
| [Indexer and GraphQL](../developers/indexer.md) | The data the agent reads |
| [Hosting report](../resources/hosting-report.md) | Kimi K3 and K2.6 endpoint counts |

{% hint style="warning" %}
The agent will explain grades, but it does not replace them. Its verdict is only as good as the verifiers you trust, and every claim it makes should link to a grade or a check you can rerun.
{% endhint %}

Next: [Threat model](../security/threat-model.md)
