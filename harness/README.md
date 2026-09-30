# assay_probe.py

This script grades every OpenRouter host of one model against the lab's own endpoint. It checks tool-call correctness and whether the host enforces request parameters, and it uses only the Python standard library.

## How it works

1. It pulls the model's endpoint list from `GET /api/v1/models/{model}/endpoints`, which is public and needs no API key.
2. For each endpoint, it pins requests to that host with `provider: {"only": [tag], "allow_fallbacks": false}`. It then runs 4 test cases `--repeats` times each, plus one `max_tokens` check.
   - Three of the cases are tool calls. They check that the host picked the right tool and returned valid JSON that matches the schema with the exact expected argument values.
   - The fourth case is a trap, where the correct answer is to call no tool at all.
3. It writes every response to `raw_<timestamp>.jsonl`, and each host's pass rate with a 95% Wilson confidence interval to `summary_<timestamp>.csv`.
4. It marks a host `BELOW REFERENCE` when that host's whole confidence interval sits under the reference host's interval.

## Cost

Start with `--dry-run`, which prints an estimate without calling any model. For GLM-5.3 across its 37 endpoints at 10 repeats, the estimate is about $2.40, and Kimi K3 comes to about $3.70. Reasoning models write more tokens than the estimate assumes, so budget several times the printed number. The first real run should still fit well inside $25 of OpenRouter credit.

## Known limits

The checks only cover tool calls and `max_tokens` so far. Context length, language following and model identity are the next checks to add.

Temperature 0 doesn't guarantee identical outputs, so judge a host by its pass rate over many repeats and never by a single response.

The reference is the lab's endpoint as OpenRouter serves it (for example `z-ai/fp8`). Before publishing anything, test the lab's direct API as well.

Any host marked `BELOW REFERENCE` gets its logs and 7 days to respond before its results are published.
