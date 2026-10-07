# Mida Context × ASSAY

> assay proves which model and host produced a response, mida proves which agent saved what, for whom, and who may read it.

## What this is

One small Node program in this folder, `examples/mida-context/mida/`, with three commands. `ask` sends one prompt through ASSAY's testnet host with a fresh salt and keeps the salt and the output in a private file. `write` runs as a Mida agent the owner approved and saves the receipt and its salt inside the encrypted body of one Mida record. `read` runs as a second, separately approved agent: it finds that record, hands it to ASSAY's own `verifyReceipt`, and refuses the context if the chain or the salt disagree. Nothing in ASSAY's SDK, host, contracts, web app or CI is changed.

## How it works

`ask` prints the receipt it was given and where the private run file went:

```
asked: receipt 0x9a166cac… from host erc8004:10143:1962, model gemma-4-31b-it — output "OK" (3 tokens in, 1 out)
saved: runs/0x9a166cac….json holds the salt and the output (mode 600; never commit it). The host anchors every ~30 s; then run: write 0x9a166cac…
```

`write` prints what the chain says about the receipt, that the writer is approved, and the record it saved:

```
assay: receipt 0x9a166cac… is anchored under host 1962 — root 0x8c89bd8a…, tx 0x41f73bca…
mida: assay-writer approved for this folder
recorded: Mida record 0x547a8f2f… (anchored) in projects.current, author assay-writer — receipt 0x9a166cac…, salt and output inside the encrypted body
```

`read` prints which record it took, every check ASSAY's SDK ran, and the verdict:

```
mida: record 0x547a8f2f… written by assay-writer (AGENT_INFERRED, 2026-10-09T10:12:31Z) holds receipt 0x9a166cac…
assay: jws pass · hash pass · kid pass · merkle pass · anchored pass (host 1962 on 0x63e4…1a24) · outputCommit pass · promptCommit pass · cosigned skipped
accepted: host erc8004:10143:1962 (trusted) served model gemma-4-31b-it; the salt opens the commitments. Output: "OK"
```

## Setup for the owner

About twenty minutes, once, all on Monad testnet. Every `mida` command starts with `MIDA_HOME=$HOME/.mida-assay`: without it, `mida` uses the everyday home and the revoke later would land there.

1. **A Mida home just for this demo** (`~/.mida-assay`), so a revoke here cannot touch everyday agents:

   ```
   MIDA_HOME=$HOME/.mida-assay mida init
   MIDA_HOME=$HOME/.mida-assay mida batching off
   ```

2. **Two agent identities:**

   ```
   MIDA_HOME=$HOME/.mida-assay mida add-agent assay-writer
   MIDA_HOME=$HOME/.mida-assay mida add-agent assay-reader
   ```

3. **Approve both for this folder** — inside `examples/mida-context/mida/`, for each name:

   ```
   MIDA_HOME=$HOME/.mida-assay mida request assay-writer
   MIDA_HOME=$HOME/.mida-assay mida approve assay-writer      # type yes
   MIDA_HOME=$HOME/.mida-assay mida request assay-reader
   MIDA_HOME=$HOME/.mida-assay mida approve assay-reader      # type yes
   ```

   This creates `.mida/project.json` here; the folder's `.gitignore` keeps `.mida/` out of the repository.

4. **Build ASSAY's SDK once, with their own tools, at the repository root** (this is the one place pnpm is used, by the owner, for their package — this folder uses npm):

   ```
   cd ~/Desktop/assay-mida && corepack pnpm install --frozen-lockfile && corepack pnpm --filter @assay/receipts build
   ```

   This writes `sdk/dist/` (gitignored) and nothing else; `git status` must stay clean.

5. **`.env` in this folder** from `.env.example`. `MIDA_HOME` must be an absolute path — Node's `--env-file` does not expand `$HOME`, so write `MIDA_HOME=/Users/Admin/.mida-assay`. The rest can stay at defaults.

## Run

```
node --env-file=.env src/cli.js ask "Say OK"
# wait about 30 s for the host to anchor the receipt
node --env-file=.env src/cli.js write 0x9a166cac…        # the hash `asked:` printed
node --env-file=.env src/cli.js read                     # or: read 0x9a166cac…
```

Exit codes: 0 done · 1 a setup problem (config, usage, their SDK not built) · 2 a refusal by the ASSAY side or a bad input (the line says what to do) · 3 Mida refused or is unavailable · 4 a network problem (host or RPC). `write` again on the same receipt prints `already recorded …` and exits 0 — the same receipt is never saved twice.

## Revoke

```
MIDA_HOME=$HOME/.mida-assay mida revoke assay-reader     # type yes
node --env-file=.env src/cli.js read
```

The next `read` prints `mida: refused (revoked) …` and exits 3. Revocation is forward-only: it stops that agent's future reads; the record stays anchored and readable by the writer and the owner, and the receipt is as valid as before — the host's own reproduce line (`cast call 0x63e4… "verifyReceipt(uint256,bytes32,bytes32[],bytes32)(bool)" 1962 <hash> "[<proof>]" <root> --rpc-url https://testnet-rpc.monad.xyz`) still returns `true`.

## Decision rules

In this order, stopping at the first refusal; the reader is the half ASSAY's own check can take over unchanged.

| # | Rule | Source of truth | On failure |
|---|---|---|---|
| R1 | Config is valid, and the reader and writer are different agent names. | `.env` | exit 1 |
| R2 | ASSAY's built SDK can be loaded. | `../../../sdk/dist/index.js` exists and imports | exit 1 |
| R3 | The Mida service answers and the reader is approved; every page of `projects.current` arrives whole (no `partial`). | `mida.context()` | exit 3 |
| R4 | A candidate exists: the newest item with `content.assayReceipt === 1` whose chain facts say the writer wrote it (`source === "AGENT_INFERRED"`, non-zero `author.id`, `author.name === ASSAY_WRITER_AGENT`). With `read <hash>`, the newest such item with that `receiptHash`. | the chain's author and source, never the content | exit 2 |
| R5 | The record's fields are well-formed: `chainId` equals the configured chain, `anchor.contract` equals the configured `ReceiptAnchor` (case-insensitive), `receiptHash`, `root` and `salt` are 32-byte hex, `proof` is an array of 32-byte hex, `jws` is a three-part string, `jwks.keys` is an array, `body` is an object, `output` is a string. Only allow-listed fields are copied. | the record | exit 2 |
| R6 | ASSAY's check: `jws`, `hash`, `kid`, `merkle`, `anchored` and `outputCommit` are all `pass`; `promptCommit` is `pass` when `messages` is present and `skipped` is acceptable only when it is absent; `cosigned` is not `fail`. **`ok` is not consulted** — it is `true` when checks were skipped. | `verifyReceipt` with `onchain: { client, anchor: config.receiptAnchor }` | exit 2, naming every check that is not `pass` |
| R7 | The host is one the reader trusts: `body.host.agentId` is in `ASSAY_TRUSTED_HOSTS` (default `erc8004:10143:1962`). Sound only because R6 proved `hash: pass`, which means `body` is the body the host signed. | config, never the record | exit 2 |
| Accept | Print the accepted line with the output text. | | exit 0 |

The trusted-host list exists because anyone can register an ERC-8004 identity, set a host key and anchor their own receipts; such a receipt passes every check in R6. The reader says which hosts it accepts in its own configuration — along with the contract address and the writer's name, which are why the contract address and trusted hosts always come from config and never from the record.

## The record

One record in `projects.current`, kind `EPISODE`, written by `assay-writer`. Everything below lives inside the record's encrypted body — ciphertext off-chain; on Monad the record keeps its existence, author, time, source and a hash of the encrypted content:

- `assayReceipt: 1`, `chainId`, `receiptHash` — what this record is and which receipt it holds.
- `body`, `jws`, `jwks` — the signed receipt body, the JWS, and the host's keys, exactly as the host returned them.
- `anchor` — the contract, the host's agent id, the Merkle `root`, the `proof`, and the anchor transaction.
- `salt`, `output`, `messages` — the private half of the receipt and what it produced.
- `source`, `savedAt` — where the receipt came from and when it was saved.

What ASSAY's team can see: that a record exists, who wrote it and when, and the receipt's hash on their own side. What they cannot see: the record's content — there is no public field in a Mida record, so linking the anchored record to the receipt it holds needs the encrypted body, which only approved agents and the owner can read.

## Limits

Monad testnet, not audited — on both sides. A receipt proves which host served which bytes and what it claimed, not which weights ran; anyone can be a host, so the reader trusts only the hosts in its configuration (default `erc8004:10143:1962`). The stored JWKS is not compared with `hostKeys()` on chain. Mida allows one write per minute per agent. The salt is the private half of the receipt: it lives in `runs/` (mode 600, gitignored) — with it anyone can open the commitments of those answers; without it nobody can.

## Where their check plugs in

`src/record.js` exports `readAssayRecord(mida, config)` — the allow-listed record with the author and time the chain recorded — and `toVerifyInput(record, { client, anchor })` — exactly ASSAY's `VerifyInput` (`params` is never set; their check takes it from the signed body). `src/check.js` is the part ASSAY's team said they would write: replace it or import from it.

## Files

- `src/cli.js` — the three commands and the wiring (config, their SDK, fetch, the viem client, the Mida handle).
- `src/config.js` — environment to config, validated; reader and writer must differ.
- `src/assay-sdk.js` — the bridge that loads `../../../sdk/dist/index.js`; nothing of theirs is re-typed.
- `src/host.js` — `ask` through their `wrap()`, fetching the anchored receipt and JWKS, and the private run file.
- `src/record.js` — the record shape, the allow-list, the chain-facts filter and the page-walk.
- `src/writer.js` — `write`: what the writer re-derives before it saves one record.
- `src/reader.js` — `read`: find the writer's record, run their check, hand the output on or refuse.
- `src/check.js` — the check verdict and the check strip.
- `test/` — unit tests against fakes, plus three testnet fixtures copied verbatim from `docs/interop/assay-receipts/`.
- `runs/` — created at run time; holds the salts, mode 600, gitignored, never committed.

## Credits

ASSAY's team for the receipts, the host and the SDK; Mida for the record and the reader.
