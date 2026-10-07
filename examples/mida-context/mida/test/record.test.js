import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  PartialListError,
  RecordError,
  buildRecord,
  isWrittenBy,
  parseRecord,
  pickRecord,
  readAssayRecord,
  toVerifyInput,
} from "../src/record.js";

const FIXTURE_URL = new URL(
  "./fixtures/0x9a166cacb2ffe4784ad556f69b690b7cebf71150f737a5a3c324f9e98e7907e5.json",
  import.meta.url,
);
const fixture = JSON.parse(await readFile(FIXTURE_URL, "utf8"));
const body = JSON.parse(Buffer.from(fixture.jws.split(".")[1], "base64url").toString("utf8"));

const HOST = "https://34-45-1-81.sslip.io";
const ANCHOR = "0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24";
const MAINNET_ANCHOR = "0x049A73755cA3508ef3Daa4752A3406f6e00CfB13";
const SALT = "0x" + "aa".repeat(32);
const NOW = 1790954324495;
const CONFIG = { chainId: 10143, receiptAnchor: ANCHOR, writerAgent: "assay-writer" };

const AGENT_ID = "0x" + "12".repeat(32);
const ZERO_ID = "0x" + "0".repeat(64);
const H1 = "0x" + "11".repeat(32);
const H2 = "0x" + "22".repeat(32);

const item = (content, author, source, id = "0x" + "ee".repeat(32)) => ({
  id,
  namespace: "projects.current",
  kind: "EPISODE",
  content,
  author,
  source,
  writtenAt: "2026-10-09T10:12:31.204Z",
  state: "anchored",
  superseded: false,
  references: [],
  proof: { manifestHash: "0x" + "99".repeat(32), recordId: id },
});

const writer = { name: "assay-writer", id: AGENT_ID };
const reader = { name: "assay-reader", id: "0x" + "34".repeat(32) };

const goodContent = () => ({
  assayReceipt: 1,
  chainId: 10143,
  receiptHash: fixture.receiptHash,
  body,
  jws: fixture.jws,
  jwks: fixture.jwks,
  anchor: { contract: ANCHOR, agentId: 1962, root: fixture.anchor.root, proof: fixture.anchor.proof, tx: fixture.anchor.tx },
  salt: SALT,
  output: "OK",
  messages: [{ role: "user", content: "Say OK" }],
  source: `${HOST}/v1/receipts/${fixture.receiptHash}`,
  savedAt: "2026-10-09T10:12:31.204Z",
});

async function problem(promise) {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error("did not reject");
}
const throws = (fn) => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("did not throw");
};

describe("buildRecord", () => {
  it("builds the section-7.2 content, keys in order, no type key", () => {
    const run = {
      receiptHash: fixture.receiptHash,
      chainId: 10143,
      salt: SALT,
      output: "OK",
      messages: [{ role: "user", content: "Say OK" }],
    };
    const anchored = {
      status: "anchored",
      body,
      jws: fixture.jws,
      root: fixture.anchor.root,
      proof: fixture.anchor.proof,
      anchorTx: fixture.anchor.tx,
    };
    const record = buildRecord({ run, anchored, jwks: fixture.jwks, host: HOST, anchor: ANCHOR, now: () => NOW });
    expect(Object.keys(record)).toEqual([
      "assayReceipt", "chainId", "receiptHash", "body", "jws", "jwks",
      "anchor", "salt", "output", "messages", "source", "savedAt",
    ]);
    expect(Object.keys(record.anchor)).toEqual(["contract", "agentId", "root", "proof", "tx"]);
    expect(record).toEqual({
      assayReceipt: 1,
      chainId: 10143,
      receiptHash: fixture.receiptHash,
      body,
      jws: fixture.jws,
      jwks: fixture.jwks,
      anchor: { contract: ANCHOR, agentId: 1962, root: fixture.anchor.root, proof: [], tx: fixture.anchor.tx },
      salt: SALT,
      output: "OK",
      messages: [{ role: "user", content: "Say OK" }],
      source: `${HOST}/v1/receipts/${fixture.receiptHash}`,
      savedAt: new Date(NOW).toISOString(),
    });
    expect(Object.hasOwn(record, "type")).toBe(false);
  });

  it("omits messages when the run kept none", () => {
    const run = { receiptHash: fixture.receiptHash, chainId: 10143, salt: SALT, output: "OK" };
    const anchored = { status: "anchored", body, jws: fixture.jws, root: fixture.anchor.root, proof: [], anchorTx: fixture.anchor.tx };
    const record = buildRecord({ run, anchored, jwks: fixture.jwks, host: HOST, anchor: ANCHOR, now: () => NOW });
    expect(Object.hasOwn(record, "messages")).toBe(false);
    expect(Object.keys(record)).toEqual([
      "assayReceipt", "chainId", "receiptHash", "body", "jws", "jwks",
      "anchor", "salt", "output", "source", "savedAt",
    ]);
  });
});

describe("isWrittenBy", () => {
  it("trusts only chain facts: AGENT_INFERRED, non-zero author.id, writer's name", () => {
    expect(isWrittenBy(item({}, writer, "AGENT_INFERRED"), "assay-writer")).toBe(true);
    expect(isWrittenBy(item({}, writer, "USER_ASSERTED"), "assay-writer")).toBe(false);
    expect(isWrittenBy(item({}, { name: "assay-writer", id: ZERO_ID }, "AGENT_INFERRED"), "assay-writer")).toBe(false);
    expect(isWrittenBy(item({}, reader, "AGENT_INFERRED"), "assay-writer")).toBe(false);
    expect(isWrittenBy(item({}, { name: "assay-writer", id: "0x123" }, "AGENT_INFERRED"), "assay-writer")).toBe(false);
  });
});

describe("pickRecord", () => {
  const items = [
    item({ type: "mida.checkpoint.v1", checkpoint: {} }, writer, "AGENT_INFERRED", "0x" + "01".repeat(32)),
    item({ assayReceipt: 1, receiptHash: H1 }, reader, "AGENT_INFERRED", "0x" + "02".repeat(32)),
    item({ assayReceipt: 1, receiptHash: H1, author: { name: "assay-writer" } }, { name: null, id: ZERO_ID }, "USER_ASSERTED", "0x" + "03".repeat(32)),
    item({ assayReceipt: 1, receiptHash: H2 }, writer, "AGENT_INFERRED", "0x" + "04".repeat(32)),
  ];

  it("takes the newest record the chain says the writer wrote", () => {
    expect(pickRecord(items, { writerName: "assay-writer" })).toBe(items[3]);
  });

  it("returns null when nothing qualifies", () => {
    expect(pickRecord(items.slice(0, 3), { writerName: "assay-writer" })).toBe(null);
  });

  it("matches receiptHash case-insensitively", () => {
    expect(pickRecord(items, { writerName: "assay-writer", receiptHash: H2.toUpperCase() })).toBe(items[3]);
    expect(pickRecord(items, { writerName: "assay-writer", receiptHash: H1 })).toBe(null);
  });

  it("ignores items whose content is not an object", () => {
    const stringy = item("a string record", writer, "AGENT_INFERRED");
    expect(pickRecord([stringy, ...items], { writerName: "assay-writer" })).toBe(items[3]);
  });
});

describe("parseRecord", () => {
  const good = item(goodContent(), writer, "AGENT_INFERRED");

  it("returns the item's chain facts and an allow-listed record", () => {
    const { id, author, writtenAt, record } = parseRecord(good, CONFIG);
    expect(id).toBe(good.id);
    expect(author).toBe(writer);
    expect(writtenAt).toBe(good.writtenAt);
    expect(record).toEqual(goodContent());
    expect(Object.hasOwn(record, "type")).toBe(false);
  });

  it("refuses a record from the wrong chain", () => {
    const bad = item({ ...goodContent(), chainId: 143 }, writer, "AGENT_INFERRED");
    const e = throws(() => parseRecord(bad, CONFIG));
    expect(e).toBeInstanceOf(RecordError);
    expect(e.exitCode).toBe(2);
    expect(e.message).toContain("chainId");
    expect(e.message).toBe(
      `read: record ${bad.id.slice(0, 10)}… is not a usable receipt record (chainId: is 143, this reader checks chain 10143). Nothing was handed on.`,
    );
  });

  it("refuses a record naming another ReceiptAnchor, naming both addresses", () => {
    const bad = item(
      { ...goodContent(), anchor: { ...goodContent().anchor, contract: MAINNET_ANCHOR } },
      writer, "AGENT_INFERRED",
    );
    const e = throws(() => parseRecord(bad, CONFIG));
    expect(e).toBeInstanceOf(RecordError);
    expect(e.message).toBe(
      `read: record ${bad.id.slice(0, 10)}… names ReceiptAnchor ${MAINNET_ANCHOR}, but this reader checks ${ANCHOR}. Nothing was handed on.`,
    );
  });

  it("accepts the configured contract in any case", () => {
    const ok = item(
      { ...goodContent(), anchor: { ...goodContent().anchor, contract: ANCHOR.toLowerCase() } },
      writer, "AGENT_INFERRED",
    );
    expect(() => parseRecord(ok, CONFIG)).not.toThrow();
  });

  it("refuses a salt that is not 32 bytes", () => {
    const bad = item({ ...goodContent(), salt: "0x" + "aa".repeat(31) }, writer, "AGENT_INFERRED");
    const e = throws(() => parseRecord(bad, CONFIG));
    expect(e).toBeInstanceOf(RecordError);
    expect(e.message).toContain("salt");
  });

  it("drops keys outside the allow-list, including a forged author", () => {
    const c = { ...goodContent(), author: { name: "x" }, extra: "dropped" };
    const { record, author } = parseRecord(item(c, writer, "AGENT_INFERRED"), CONFIG);
    expect(Object.hasOwn(record, "author")).toBe(false);
    expect(Object.hasOwn(record, "extra")).toBe(false);
    expect(author).toBe(writer);
  });

  it("parses a record whose content carries a checkpoint-looking type key", () => {
    const c = { ...goodContent(), type: "mida.checkpoint.v1" };
    const { record } = parseRecord(item(c, writer, "AGENT_INFERRED"), CONFIG);
    expect(Object.hasOwn(record, "type")).toBe(false);
    expect(record.assayReceipt).toBe(1);
  });
});

describe("toVerifyInput", () => {
  const client = { readContract: async () => [1, 2n] };

  it("hands exactly their VerifyInput, the configured anchor, never params", () => {
    const { record } = parseRecord(item(goodContent(), writer, "AGENT_INFERRED"), CONFIG);
    const input = toVerifyInput(record, { client, anchor: ANCHOR });
    expect(Object.keys(input)).toEqual(["body", "jws", "jwks", "proof", "root", "onchain", "salt", "output", "messages"]);
    expect(input.onchain).toEqual({ client, anchor: ANCHOR });
    expect(input.proof).toBe(record.anchor.proof);
    expect(input.root).toBe(record.anchor.root);
    expect(Object.hasOwn(input, "params")).toBe(false);
  });

  it("omits messages when the record kept none", () => {
    const c = goodContent();
    delete c.messages;
    const { record } = parseRecord(item(c, writer, "AGENT_INFERRED"), CONFIG);
    const input = toVerifyInput(record, { client, anchor: ANCHOR });
    expect(Object.hasOwn(input, "messages")).toBe(false);
    expect(Object.keys(input)).toEqual(["body", "jws", "jwks", "proof", "root", "onchain", "salt", "output"]);
  });
});

describe("readAssayRecord", () => {
  it("walks pages until the newest writer record and returns item plus record", async () => {
    const calls = [];
    const other = item({ assayReceipt: 1, receiptHash: H1 }, writer, "AGENT_INFERRED", "0x" + "0a".repeat(32));
    const mine = item(goodContent(), writer, "AGENT_INFERRED", "0x" + "0b".repeat(32));
    const pages = [
      { items: [other], cursor: "c1", otherTasks: [] },
      { items: [mine], cursor: null, otherTasks: [] },
    ];
    const mida = { context: async (input) => { calls.push(input); return pages.shift(); } };
    const found = await readAssayRecord(mida, CONFIG, { receiptHash: fixture.receiptHash });
    expect(calls).toEqual([
      { namespace: "projects.current", limit: 65_536 },
      { namespace: "projects.current", limit: 65_536, cursor: "c1" },
    ]);
    expect(found.item).toBe(mine);
    expect(found.id).toBe(mine.id);
    expect(found.author).toBe(writer);
    expect(found.record.receiptHash).toBe(fixture.receiptHash);
  });

  it("stops on a partial page", async () => {
    const mida = {
      context: async () => ({ items: [], cursor: null, otherTasks: [], partial: true }),
    };
    const e = await problem(readAssayRecord(mida, CONFIG));
    expect(e).toBeInstanceOf(PartialListError);
    expect(e.exitCode).toBe(3);
  });

  it("returns null when no record qualifies", async () => {
    const mida = { context: async () => ({ items: [], cursor: null, otherTasks: [] }) };
    expect(await readAssayRecord(mida, CONFIG)).toBe(null);
  });
});
