# harness

The harness has two scripts, and both use only the Python 3 standard library.

| Script | Does |
|---|---|
| `assay_probe.py` | Grades hosts of one model against a reference endpoint and writes the raw log and a summary. |
| `export_grade.py` | Turns one probe run into `VerifierRegistry` grades and an evidence bundle. |

## assay_probe.py

It checks tool-call correctness and whether the host enforces request parameters.

### How it works

1. By default it pulls the model's endpoint list from `GET /api/v1/models/{model}/endpoints`, which is public and needs no API key.
2. For each endpoint, it pins requests to that host with `provider: {"only": [tag], "allow_fallbacks": false}`. It then runs 4 test cases `--repeats` times each, plus one `max_tokens` check.
   - Three of the cases are tool calls. They check that the host picked the right tool and returned valid JSON that matches the schema with the exact expected argument values.
   - The fourth case is a trap, where the correct answer is to call no tool at all.
3. It writes every response to `raw_<stamp>.jsonl`, and each host's pass rate with a 95% Wilson confidence interval to `summary_<stamp>.csv`. The summary also records the model id and which row is the reference.
4. It marks a host `BELOW REFERENCE` when that host's whole confidence interval sits under the reference host's interval.

### Direct endpoints

Any OpenAI-compatible API can be graded or used as the reference. Direct endpoints get no `provider` field and are tagged `direct:<host>`.

| Flag | Meaning |
|---|---|
| `--base-url URL` | Grade this endpoint instead of OpenRouter's hosts. |
| `--api-key-env NAME` | Env var with its API key. No key is sent if unset. |
| `--tag TAG` | Tag for the `--base-url` endpoint. Default `direct:<host>`. |
| `--reference-base-url URL` | Use this endpoint, usually the lab's own API, as the reference. Replaces `--reference`. |
| `--reference-model ID` | Model id at the reference URL. Default `--model`. |
| `--reference-api-key-env NAME` | Env var with the reference API key. No key is sent if unset. |

Each endpoint receives its own key and never the key of another endpoint.

### The $0 Gemma route

Gemma 4 31B is free on OpenRouter and on the Google AI Studio free tier, so the whole comparison costs nothing.

```bash
cd harness
python3 assay_probe.py --model google/gemma-4-31b-it:free \
  --reference-base-url https://generativelanguage.googleapis.com/v1beta/openai \
  --reference-model gemma-4-31b-it --reference-api-key-env GEMINI_API_KEY --dry-run
```

Drop `--dry-run` once `GEMINI_API_KEY` and `OPENROUTER_API_KEY` are set. Check the model id in AI Studio's model list first. On 2 Oct OpenRouter listed one free endpoint for this model, tagged `google-ai-studio`, so this run compares OpenRouter's pass-through with Google's own API.

### Cost

Start with `--dry-run`. It prints an estimate and calls no model. Without `--base-url` it makes one free request for the endpoint list. With `--base-url` it makes no requests at all. Direct endpoints show `n/a` because the provider bills them.

For GLM-5.3 across its 37 endpoints at 10 repeats, the estimate is about $2.40, and Kimi K3 comes to about $3.70. Reasoning models write more tokens than the estimate assumes, so budget several times the printed number.

## export_grade.py

```bash
cd harness
python3 export_grade.py                      # newest run in assay_out/
python3 export_grade.py --stamp 20261005T101500Z --assay-agent 10143:1962 --assay-tag direct:assay.example.com
```

| Output | Contents |
|---|---|
| `grades_<stamp>.json` | One Grade per endpoint with the SPEC section 5 fields, plus `tag` and `hostKeyPreimage` for readers. |
| `evidence_<stamp>.tar.gz` | The run's `summary` CSV and `raw` JSONL. The archive is deterministic, so the same run always gives the same hash. |
| `evidence_<stamp>.tar.gz.sha256` | Its sha256, in `sha256sum` format. This is the `evidence` field. |

`--model` and `--reference` override the summary's columns, which older runs don't have. `passed` and `total` are recounted from the raw log and must match the summary. An endpoint with no successful responses is listed under `skipped`, because the registry rejects `total = 0`.

### Encodings

| Field | Value |
|---|---|
| `model` | `keccak256(utf8(model id))`, e.g. `z-ai/glm-5.3` |
| `hostKey` (OpenRouter endpoint) | `keccak256(utf8("openrouter:" + tag))` |
| `hostKey` (other direct endpoint) | `keccak256(utf8("direct:<host>"))`, its tag as is |
| `hostKey` (Assay host, `--assay-agent CHAIN:ID`) | `keccak256(utf8("erc8004:<chain>:<id>"))` |
| `checks` | `keccak256(utf8("assay-checks/tool-calls-v0"))` |
| `refModel` | `keccak256(utf8(reference tag))` |
| `passed`, `total` | Tool cases with HTTP 200, from the raw log |
| `ciLowBps`, `ciHighBps` | 95% Wilson interval. Low rounds down, high rounds up, both clamped to `[0, 10000]`. |
| `evidence` | `0x` + sha256 of the evidence tarball |
| `t` | The run's stamp as Unix seconds |

Keccak uses `cast keccak` when Foundry is installed and a bundled pure-Python Keccak-256 otherwise. `hashlib.sha3_256` is a different hash and is not used.

## Tests

```bash
python3 -m unittest harness/test_export_grade.py harness/test_assay_probe.py
```

The tests mock every HTTP call, so they never reach the network.

## Known limits

The checks only cover tool calls and `max_tokens` so far. Context length, language following and model identity are the next checks to add.

Temperature 0 doesn't guarantee identical outputs, so judge a host by its pass rate over many repeats and never by a single response.

Any host marked `BELOW REFERENCE` gets its logs and 7 days to respond before its results are published.
