# Agent trust check: MonadGuard + Assay

Two separate questions an agent should answer before it acts:

- **The tool.** [MonadGuard](https://github.com/poteshniy/monadguard) attests a static artifact: the manifest an MCP server declares, pinned to its content hash.
- **The model host.** [Assay](https://github.com/trudransh/Assay) attests a runtime event: which host served which bytes and what it claimed, and open verifiers grade hosts against the lab's own API.

`check.mjs` runs both as independent, fail-closed checks at one call site. The caller pins the attestors, the verifiers and the threshold.

```bash
npm i monadguard
MONADGUARD_ATTESTOR=0x… node check.mjs
```

## What this does not claim

- A CLEAN MonadGuard verdict means the declared interface carried no known pattern. It doesn't mean the code behind it is safe.
- An Assay grade covers the host for one model, from the verifiers you chose. A receipt proves who served which bytes and what they claimed, not which weights ran.
- Passing both checks doesn't combine into a stronger statement than either one alone. There's no shared trust model and no cross-vouching.
