import { verifyProof, type ReceiptBody } from "@assay/receipts";
import { parseEther, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { createBatcher } from "../src/batcher.js";
import { TxRevertedError } from "../src/chain.js";
import { Store } from "../src/store.js";
import { mockClient, newSigner, quietLog, tempDir, type MockClient } from "./helpers.js";

const ANCHOR = "0x049A73755cA3508ef3Daa4752A3406f6e00CfB13" as Address;
const h = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

async function setup(clients: MockClient[], n = 3, batchMax = 64) {
  const store = new Store(tempDir());
  for (let i = 1; i <= n; i++) store.addReceipt({ hash: h(i), body: {} as ReceiptBody, jws: "x" });
  const log = quietLog();
  const b = createBatcher({
    store,
    signer: await newSigner(),
    clients,
    anchor: ANCHOR,
    agentId: 1962n,
    relayer: "0x0000000000000000000000000000000000000001",
    batchSeconds: 300,
    batchMax,
    log,
  });
  return { store, b, log };
}

describe("batcher", () => {
  it("reports when its next batch fires once started, and nothing when stopped", async () => {
    const { b } = await setup([mockClient()], 0);
    expect(b.schedule()).toBeUndefined();
    b.start();
    const s = b.schedule()!;
    expect(s.batchSeconds).toBe(300);
    expect(s.nextBatchInMs).toBeGreaterThan(299_000);
    expect(s.nextBatchInMs).toBeLessThanOrEqual(300_000);
    b.stop();
    expect(b.schedule()).toBeUndefined();
  });

  it("never anchors an empty queue", async () => {
    const c = mockClient();
    const { b } = await setup([c], 0);
    expect(await b.tick()).toBeNull();
    expect(c.estimates).toBe(0);
    expect(c.writes).toHaveLength(0);
  });

  it("anchors pending receipts with gas = estimate * 1.2 and records proofs", async () => {
    const c = mockClient({ gas: 61_000n });
    const { b, store } = await setup([c]);
    const root = await b.tick();
    expect(c.writes).toHaveLength(1);
    const w = c.writes[0];
    expect(w.functionName).toBe("anchor");
    expect(w.gas).toBe(73_200n);
    expect(w.args.slice(0, 3)).toEqual([1962n, root, 3]);
    expect(store.pending()).toEqual([]);
    const batch = store.getBatch(h(2))!;
    expect(verifyProof(h(2), batch.proofs[h(2)], root!)).toBe(true);
    expect(await b.tick()).toBeNull();
  });

  it("retries once on the second RPC when the first fails", async () => {
    const one = mockClient({ fail: true });
    const two = mockClient();
    const { b, store, log } = await setup([one, two]);
    expect(await b.tick()).not.toBeNull();
    expect(one.estimates).toBe(1);
    expect(two.writes).toHaveLength(1);
    expect(store.pending()).toEqual([]);
    expect(log.lines.join()).toMatch(/retrying on RPC 2/);
  });

  it("keeps receipts queued when both RPCs fail", async () => {
    const one = mockClient({ fail: true });
    const two = mockClient({ fail: true });
    const { b, store } = await setup([one, two]);
    await expect(b.tick()).rejects.toThrow("rpc down");
    expect(one.estimates + two.estimates).toBe(2);
    expect(store.pending()).toHaveLength(3);
  });

  it("treats a reverted receipt as failure and does not resend", async () => {
    const one = mockClient({ revert: true });
    const two = mockClient();
    const { b, store } = await setup([one, two]);
    await expect(b.tick()).rejects.toBeInstanceOf(TxRevertedError);
    expect(two.estimates).toBe(0);
    expect(store.pending()).toHaveLength(3);
  });

  it("caps a batch at batchMax and anchors as soon as batchMax receipts wait", async () => {
    const c = mockClient();
    const { b, store } = await setup([c], 3, 2);
    b.notify();
    await b.tick(); // joins the in-flight anchor started by notify
    expect(c.writes).toHaveLength(1);
    expect(c.writes[0].args[2]).toBe(2);
    expect(store.pending()).toHaveLength(1);
    b.notify(); // 1 < batchMax: waits for the timer
    expect(c.estimates).toBe(1);
  });

  it("warns when the relayer balance drops below 1 MON", async () => {
    const { b, log } = await setup([mockClient({ balance: parseEther("0.5") })]);
    await b.tick();
    expect(log.lines.join()).toMatch(/below 1 MON/);
  });
});
