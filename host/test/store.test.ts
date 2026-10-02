import { appendFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ReceiptBody } from "@assay/receipts";
import type { Hex } from "viem";
import { Store } from "../src/store.js";

const h = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const rec = (n: number) => ({ hash: h(n), body: { t: n } as unknown as ReceiptBody, jws: `jws${n}` });

describe("Store", () => {
  it("queues receipts until a batch covers them, and survives a restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "assay-store-"));
    const s = new Store(dir);
    s.addReceipt(rec(1));
    s.addReceipt(rec(2));
    s.addReceipt(rec(3));
    s.addBatch({ root: h(9), count: 2, anchorTx: h(8), proofs: { [h(1)]: [h(2)], [h(2)]: [h(1)] }, anchoredAt: 1 });
    expect(s.pending()).toEqual([h(3)]);

    const again = new Store(dir);
    expect(again.pending()).toEqual([h(3)]);
    expect(again.getReceipt(h(1))?.jws).toBe("jws1");
    expect(again.getBatch(h(2))?.root).toBe(h(9));
    expect(again.getBatch(h(3))).toBeUndefined();
  });

  it("is append-only on disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "assay-store-"));
    const s = new Store(dir);
    s.addReceipt(rec(1));
    s.addReceipt(rec(2));
    expect(readFileSync(join(dir, "receipts.jsonl"), "utf8").trim().split("\n")).toHaveLength(2);
  });

  it("ignores a partial last line left by a crash and keeps appending cleanly", () => {
    const dir = mkdtempSync(join(tmpdir(), "assay-store-"));
    new Store(dir).addReceipt(rec(1));
    appendFileSync(join(dir, "receipts.jsonl"), '{"hash":"0x');
    new Store(dir).addReceipt(rec(2));
    expect(new Store(dir).pending()).toEqual([h(1), h(2)]);
  });
});
