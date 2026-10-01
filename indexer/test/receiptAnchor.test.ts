import { describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";

const AGENT = 1962n;
const KEY_A = `0x${"a".repeat(64)}`;
const KEY_B = `0x${"b".repeat(64)}`;
const ROOT_1 = `0x${"1".repeat(64)}`;
const ROOT_2 = `0x${"2".repeat(64)}`;
const ROOT_3 = `0x${"3".repeat(64)}`;
const RECEIPT = `0x${"e".repeat(64)}`;
const PASSKEY = `0x${"f".repeat(64)}`;
const SIGNER = "0x00000000000000000000000000000000000000aa";
const DAY_1 = 1_791_000_000; // 2026-10-03 UTC
const DAY_2 = DAY_1 + 86_400;
const START = 67_269_700;

const keySet = (n: number, keyHash: string) =>
  ({
    contract: "ReceiptAnchor",
    event: "HostKeySet",
    block: { number: START + n, timestamp: DAY_1 + n },
    params: { agentId: AGENT, keyHash, qx: keyHash, qy: keyHash },
  }) as const;
const anchored = (n: number, root: string, keyHash: string, count: bigint, timestamp = DAY_1 + n) =>
  ({
    contract: "ReceiptAnchor",
    event: "Anchored",
    block: { number: START + n, timestamp },
    params: { agentId: AGENT, root, count, keyHash },
  }) as const;

describe("ReceiptAnchor handlers", () => {
  it("records key rotation history and links each anchor to the key that signed it", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        10143: {
          simulate: [
            keySet(1, KEY_A),
            anchored(2, ROOT_1, KEY_A, 4n),
            anchored(3, ROOT_2, KEY_A, 6n),
            keySet(4, KEY_B),
            anchored(5, ROOT_3, KEY_B, 1n),
          ],
        },
      },
    });

    const rotations = (await indexer.KeyRotation.getAll()).sort((a, b) => a.block - b.block);
    expect(rotations.map((r) => [r.fromKey_id, r.toKey_id, r.anchorsUnderFromKey])).toEqual([
      [undefined, `10143-1962-${KEY_A}`, 0],
      [`10143-1962-${KEY_A}`, `10143-1962-${KEY_B}`, 2],
    ]);

    const keyA = await indexer.HostKey.getOrThrow(`10143-1962-${KEY_A}`);
    expect(keyA).toMatchObject({ active: false, retiredBlock: START + 4, anchorCount: 2, receiptCount: 10 });
    const keyB = await indexer.HostKey.getOrThrow(`10143-1962-${KEY_B}`);
    expect(keyB).toMatchObject({ active: true, anchorCount: 1, receiptCount: 1 });

    expect((await indexer.Anchor.getOrThrow(`10143-1962-${ROOT_2}`)).hostKey_id).toBe(keyA.id);
    expect((await indexer.Anchor.getOrThrow(`10143-1962-${ROOT_3}`)).hostKey_id).toBe(keyB.id);
    expect(await indexer.Agent.getOrThrow("10143-1962")).toMatchObject({
      currentKey_id: keyB.id,
      keyCount: 2,
      anchorCount: 3,
      receiptCount: 11,
    });
  });

  it("counts anchors, receipts and both co-sign kinds per host per day", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        10143: {
          simulate: [
            keySet(1, KEY_A),
            anchored(2, ROOT_1, KEY_A, 5n),
            anchored(3, ROOT_2, KEY_A, 3n),
            {
              contract: "ReceiptAnchor",
              event: "Cosigned",
              block: { number: START + 4, timestamp: DAY_1 + 4 },
              params: { receiptHash: RECEIPT, requesterKey: PASSKEY, agentId: AGENT, root: ROOT_1 },
            },
            anchored(5, ROOT_3, KEY_A, 7n, DAY_2),
            {
              contract: "ReceiptAnchor",
              event: "CosignedK",
              block: { number: START + 6, timestamp: DAY_2 + 1 },
              params: { receiptHash: RECEIPT, signer: SIGNER, agentId: AGENT, root: ROOT_1 },
            },
          ],
        },
      },
    });

    expect(await indexer.HostActivity.getOrThrow("10143-1962-2026-10-03")).toMatchObject({
      anchors: 2,
      receipts: 8,
      cosigns: 1,
    });
    expect(await indexer.HostActivity.getOrThrow("10143-1962-2026-10-04")).toMatchObject({
      anchors: 1,
      receipts: 7,
      cosigns: 1,
    });

    expect(await indexer.Cosign.getOrThrow(`10143-${RECEIPT}-${PASSKEY}`)).toMatchObject({
      kind: "P256",
      anchor_id: `10143-1962-${ROOT_1}`,
    });
    expect(await indexer.Cosign.getOrThrow(`10143-${RECEIPT}-${SIGNER}`)).toMatchObject({ kind: "K" });
    expect((await indexer.Anchor.getOrThrow(`10143-1962-${ROOT_1}`)).cosignCount).toBe(2);
  });

  it("prefixes every id with the chain id", async () => {
    const indexer = createTestIndexer();
    await indexer.process({ chains: { 10143: { simulate: [keySet(1, KEY_A), anchored(2, ROOT_1, KEY_A, 1n)] } } });
    const ids = [
      ...(await indexer.Agent.getAll()),
      ...(await indexer.HostKey.getAll()),
      ...(await indexer.KeyRotation.getAll()),
      ...(await indexer.Anchor.getAll()),
      ...(await indexer.HostActivity.getAll()),
    ].map((e) => e.id);
    expect(ids).toHaveLength(5);
    for (const id of ids) expect(id).toMatch(/^10143-/);
  });
});
