import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkRecord, type ContextRecord, type ContractReader, type RecordPins } from "../src/index.js";

// A real testnet receipt with its salt and output, published on purpose so CI can open the commits offline.
const FIXTURE = new URL("../../docs/interop/mida-records/0x401a4ec7d04bc50cea1534f918c8f649937dc0acf5928a1ca7b49943e893baae.json", import.meta.url);
const record = (): ContextRecord => JSON.parse(readFileSync(FIXTURE, "utf8"));
const PINS: RecordPins = {
  trustedHosts: ["erc8004:10143:1962"],
  chains: { 10143: { anchor: "0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24", rpc: "http://unused" } },
  offline: true,
};
/// `anchors(agentId, root)` answers (count, anchoredAt); 0 means never anchored.
const chain = (anchoredAt: bigint): ContractReader => ({ readContract: async () => [1, anchoredAt] });

describe("checkRecord (Mida context)", () => {
  it("accepts the pinned fixture offline, and online when the root is anchored", async () => {
    expect(await checkRecord(record(), PINS)).toMatchObject({ ok: true, reasons: [] });
    const online = await checkRecord(record(), { ...PINS, offline: false, client: chain(1_791_200_000n) });
    expect(online.ok).toBe(true);
    expect(online.checks?.anchored).toBe("pass");
  });

  it("refuses when the root isn't anchored by the pinned contract", async () => {
    const v = await checkRecord(record(), { ...PINS, offline: false, client: chain(0n) });
    expect(v.ok).toBe(false);
    expect(v.reasons).toContain("anchored: fail");
  });

  it("refuses a wrong salt or one changed output byte", async () => {
    const salt = await checkRecord({ ...record(), salt: `0x${"00".repeat(32)}` }, PINS);
    expect(salt.reasons).toEqual(expect.arrayContaining(["outputCommit: fail", "promptCommit: fail"]));
    const out = await checkRecord({ ...record(), output: record().output + " " }, PINS);
    expect(out.reasons).toEqual(["outputCommit: fail"]);
    const prompt = await checkRecord({ ...record(), messages: [{ role: "user", content: "Say NO" }] }, PINS);
    expect(prompt.reasons).toEqual(["promptCommit: fail"]);
  });

  it("refuses a host the reader doesn't trust, and a record whose ids disagree with the receipt", async () => {
    expect((await checkRecord(record(), { ...PINS, trustedHosts: ["erc8004:143:10278"] })).reasons[0]).toMatch(/isn't a trusted host/);
    expect((await checkRecord({ ...record(), anchor: { ...record().anchor, agentId: 7 } }, PINS)).reasons[0]).toMatch(/don't match/);
    expect((await checkRecord({ ...record(), chainId: 1 }, PINS)).reasons[0]).toMatch(/chain 1/);
  });

  it("refuses a receiptHash that isn't the signed payload, and a record without its opening", async () => {
    expect((await checkRecord({ ...record(), receiptHash: `0x${"ab".repeat(32)}` }, PINS)).reasons[0]).toMatch(/sha256/);
    const { salt: _salt, ...noSalt } = record();
    expect((await checkRecord(noSalt as ContextRecord, PINS)).ok).toBe(false);
  });

  it("refuses a proof for another receipt", async () => {
    const v = await checkRecord({ ...record(), anchor: { ...record().anchor, proof: [`0x${"cd".repeat(32)}`] } }, PINS);
    expect(v.reasons).toContain("merkle: fail");
  });
});
