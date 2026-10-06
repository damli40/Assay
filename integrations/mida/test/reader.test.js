import { describe, expect, it } from "vitest";
import { MidaSdkError } from "@mida-context/sdk";
import { runRead } from "../src/reader.js";

const ANCHOR = "0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24";
const HASH = "0x9a166cacb2ffe4784ad556f69b690b7cebf71150f737a5a3c324f9e98e7907e5";
const HASH2 = "0x" + "bb".repeat(32);
const REC_ID = "0x547a8f2f" + "ab".repeat(28);
const SALT = "0x" + "aa".repeat(32);

const BODY = {
  v: "assay-receipt/0",
  model: "gemma-4-31b-it",
  host: { agentId: "erc8004:10143:1962", keyId: "kid1", alg: "ES256" },
  req: { commit: "0x" + "22".repeat(32), params: { max_tokens: 64, temperature: 0 } },
  res: { commit: "0x" + "33".repeat(32), tokensIn: 3, tokensOut: 1, finish: "stop" },
  t: 1,
  nonce: "0x" + "44".repeat(16),
};

const config = {
  chainId: 10143,
  receiptAnchor: ANCHOR,
  trustedHosts: ["erc8004:10143:1962"],
  writerAgent: "assay-writer",
  readerAgent: "assay-reader",
  rpcUrl: "https://testnet-rpc.monad.xyz",
};

const content = (over = {}) => ({
  assayReceipt: 1,
  chainId: 10143,
  receiptHash: HASH,
  body: BODY,
  jws: "a.b.c",
  jwks: { keys: [{ kid: "kid1" }] },
  anchor: { contract: ANCHOR, agentId: 1962, root: "0x" + "11".repeat(32), proof: [], tx: "0x" + "22".repeat(32) },
  salt: SALT,
  output: "OK",
  messages: [{ role: "user", content: "Say OK" }],
  source: `https://34-45-1-81.sslip.io/v1/receipts/${HASH}`,
  savedAt: "2026-10-09T10:12:31.204Z",
  ...over,
});

const writerItem = (c = content(), id = REC_ID) => ({
  id,
  namespace: "projects.current",
  kind: "EPISODE",
  content: c,
  author: { name: "assay-writer", id: "0x" + "12".repeat(32) },
  source: "AGENT_INFERRED",
  writtenAt: "2026-10-09T10:12:31.204Z",
  state: "anchored",
  superseded: false,
  references: [],
  proof: {},
});

const allPass = {
  ok: true,
  receiptHash: HASH,
  checks: {
    jws: "pass", hash: "pass", kid: "pass", merkle: "pass", anchored: "pass",
    outputCommit: "pass", promptCommit: "pass", cosigned: "skipped",
  },
  reproduce: {},
};

const read = async ({ pages, verifyResult = allPass, receiptHash } = {}) => {
  const lines = [];
  const calls = { verify: [], context: [] };
  const mida = {
    context: async (input) => {
      calls.context.push(input);
      if (pages instanceof Error) throw pages;
      return pages.shift() ?? { items: [], cursor: null, otherTasks: [] };
    },
  };
  const assay = {
    verifyReceipt: async (input) => {
      calls.verify.push(input);
      if (verifyResult instanceof Error) throw verifyResult;
      return verifyResult;
    },
  };
  const result = await runRead({
    config,
    assay,
    client: { readContract: async () => [] },
    mida,
    log: (line) => lines.push(line),
    ...(receiptHash ? { receiptHash } : {}),
  });
  return { result, lines, calls };
};

describe("runRead", () => {
  it("prints the three section-3.4 lines and hands their check the pinned input", async () => {
    const { result, lines, calls } = await read({
      pages: [{ items: [writerItem()], cursor: null, otherTasks: [] }],
    });
    expect(result).toEqual({ exitCode: 0, outcome: "accepted", output: "OK" });
    expect(lines).toEqual([
      "mida: record 0x547a8f2f… written by assay-writer (AGENT_INFERRED, 2026-10-09T10:12:31Z) holds receipt 0x9a166cac…",
      "assay: jws pass · hash pass · kid pass · merkle pass · anchored pass (host 1962 on 0x63e4…1a24) · outputCommit pass · promptCommit pass · cosigned skipped",
      'accepted: host erc8004:10143:1962 (trusted) served model gemma-4-31b-it; the salt opens the commitments. Output: "OK"',
    ]);
    const [input] = calls.verify;
    expect(input.onchain.anchor).toBe(ANCHOR);
    expect(input.onchain.client).toBeDefined();
    expect(Object.hasOwn(input, "params")).toBe(false);
    expect(input.salt).toBe(SALT);
  });

  it("a revoked reader stops on the context call, their check never runs", async () => {
    const err = new MidaSdkError("revoked", "Mida: assay-reader's access was revoked by the owner — nothing was read.");
    const { result, lines, calls } = await read({ pages: err });
    expect(result).toEqual({ exitCode: 3, outcome: "mida" });
    expect(lines).toEqual([
      "mida: refused (revoked) — Mida: assay-reader's access was revoked by the owner — nothing was read. Nothing was checked.",
    ]);
    expect(calls.verify).toHaveLength(0);
  });

  it("a partial page stops the run", async () => {
    const { result, lines, calls } = await read({
      pages: [{ items: [writerItem()], cursor: null, otherTasks: [], partial: true }],
    });
    expect(result).toEqual({ exitCode: 3, outcome: "partial" });
    expect(lines.at(-1)).toBe(
      "mida: the record list came back incomplete (the store has not verified its newest rows yet). Nothing was checked. Run again in a minute.",
    );
    expect(calls.verify).toHaveLength(0);
  });

  it("no matching record exits 2", async () => {
    const { result, lines } = await read({ pages: [{ items: [], cursor: null, otherTasks: [] }] });
    expect(result).toEqual({ exitCode: 2, outcome: "refused" });
    expect(lines.at(-1)).toBe(
      "read: no record written by assay-writer with assayReceipt 1 in projects.current. Nothing was checked.",
    );
  });

  it("a malformed record exits 2 with the record line", async () => {
    const bad = writerItem(content({ salt: "0x1234" }));
    const { result, lines } = await read({ pages: [{ items: [bad], cursor: null, otherTasks: [] }] });
    expect(result).toEqual({ exitCode: 2, outcome: "refused" });
    expect(lines.at(-1)).toBe(
      `read: record ${REC_ID.slice(0, 10)}… is not a usable receipt record (salt: not 32-byte hex). Nothing was handed on.`,
    );
  });

  it("a chain read failure exits 4 naming the contract, the rpc host and the error class", async () => {
    const err = new Error("nope");
    err.name = "HttpRequestError";
    const { result, lines } = await read({
      pages: [{ items: [writerItem()], cursor: null, otherTasks: [] }],
      verifyResult: err,
    });
    expect(result).toEqual({ exitCode: 4, outcome: "chain" });
    expect(lines.at(-1)).toBe(
      "chain: could not read ReceiptAnchor at 0x63e4…1a24 over testnet-rpc.monad.xyz (HttpRequestError). The context was not handed on.",
    );
  });

  it("read <hash> selects the matching record, not the newest unrelated one", async () => {
    const newest = writerItem(content({ receiptHash: HASH2 }), "0x" + "55".repeat(32));
    const wanted = writerItem(content(), REC_ID);
    const { result, calls } = await read({
      pages: [{ items: [newest, wanted], cursor: null, otherTasks: [] }],
      receiptHash: HASH,
    });
    expect(result.exitCode).toBe(0);
    expect(calls.verify[0].body).toBe(BODY);
  });

  it("a refused verdict hands no output onward", async () => {
    const skipped = { ...allPass, ok: true, checks: { ...allPass.checks, anchored: "skipped" } };
    const { result, lines } = await read({
      pages: [{ items: [writerItem()], cursor: null, otherTasks: [] }],
      verifyResult: skipped,
    });
    expect(result.exitCode).toBe(2);
    expect(result.output).toBeUndefined();
    expect(lines.at(-1)).toBe(
      "refused: ASSAY's check did not pass for receipt 0x9a166cac… — anchored: skipped. The context was not handed on.",
    );
  });
});
