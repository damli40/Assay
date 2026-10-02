import { describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";

const V1 = "0x0000000000000000000000000000000000000001" as `0x${string}`;
const V2 = "0x0000000000000000000000000000000000000002" as `0x${string}`;
const MODEL = `0x${"6d".repeat(32)}`;
const HOST_A = `0x${"a".repeat(64)}`;
const HOST_B = `0x${"b".repeat(64)}`;
const HOST_C = `0x${"c".repeat(64)}`;
const START = 67_461_100;
const T0 = 1_791_000_000;

let n = 0;
function grade(verifier: `0x${string}`, hostKey: string, ciLowBps: number, ciHighBps: number, passed = 40n, total = 50n) {
  n += 1;
  return {
    contract: "VerifierRegistry",
    event: "GradePosted",
    block: { number: START + n, timestamp: T0 + n },
    params: {
      verifier,
      verifierAgentId: 7n,
      model: MODEL,
      hostKey,
      passed,
      total,
      ciLowBps: BigInt(ciLowBps),
      ciHighBps: BigInt(ciHighBps),
      checks: `0x${"0".repeat(64)}`,
      refModel: `0x${"0".repeat(64)}`,
      evidence: `0x${"0".repeat(64)}`,
      t: BigInt(T0 + n),
    },
  } as const;
}

const statsId = (v: string, host: string) => `10143-${v}-${MODEL}-${host}`;

describe("VerifierRegistry handlers", () => {
  it("fires drift exactly once when a grade's interval falls below the previous one", async () => {
    const indexer = createTestIndexer();
    const first = grade(V1, HOST_A, 8000, 9000);
    const drop = grade(V1, HOST_A, 5000, 7000);
    const sameAgain = grade(V1, HOST_A, 5000, 7000);
    await indexer.process({ chains: { 10143: { simulate: [first, drop, sameAgain] } } });

    const drifts = await indexer.DriftEvent.getAll();
    expect(drifts).toHaveLength(1);
    expect(drifts[0]).toMatchObject({
      id: `${statsId(V1, HOST_A)}-${drop.params.t}`,
      previous_id: `${statsId(V1, HOST_A)}-${first.params.t}`,
      previousCiLowBps: 8000,
      ciHighBps: 7000,
      dropBps: 1000,
    });
    expect(await indexer.HostModelStats.getOrThrow(statsId(V1, HOST_A))).toMatchObject({
      gradeCount: 3,
      driftCount: 1,
      latestCiLowBps: 5000,
    });
  });

  it("does not fire drift on an improvement or an overlapping drop", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        10143: {
          simulate: [grade(V1, HOST_A, 5000, 7000), grade(V1, HOST_A, 8000, 9000), grade(V1, HOST_A, 7000, 8500)],
        },
      },
    });
    expect(await indexer.DriftEvent.getAll()).toHaveLength(0);
  });

  it("keeps a running pass rate over every grade", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: { 10143: { simulate: [grade(V1, HOST_A, 1, 2, 30n, 50n), grade(V1, HOST_A, 1, 2, 45n, 50n)] } },
    });
    expect(await indexer.HostModelStats.getOrThrow(statsId(V1, HOST_A))).toMatchObject({
      passedSum: 75n,
      totalSum: 100n,
      passRateBps: 7500,
    });
    expect((await indexer.Verifier.getOrThrow(`10143-${V1}`)).gradeCount).toBe(2);
  });

  const board = [
    () => grade(V1, HOST_A, 6000, 8000),
    () => grade(V1, HOST_B, 9000, 9500),
    () => grade(V1, HOST_C, 7000, 9000),
    () => grade(V2, HOST_A, 9900, 9999),
  ];
  async function ranksAfter(extra: () => ReturnType<typeof grade>[]) {
    const indexer = createTestIndexer();
    await indexer.process({ chains: { 10143: { simulate: [...board.map((g) => g()), ...extra()] } } });
    const rank = async (v: string, h: string) => (await indexer.HostModelStats.getOrThrow(statsId(v, h))).rank;
    return {
      ranks: { a: await rank(V1, HOST_A), b: await rank(V1, HOST_B), c: await rank(V1, HOST_C), v2a: await rank(V2, HOST_A) },
      leaderboard: await indexer.ModelLeaderboard.getOrThrow(`10143-${V1}-${MODEL}`),
    };
  }

  it("ranks hosts per verifier and model by the latest lower bound", async () => {
    const { ranks, leaderboard } = await ranksAfter(() => []);
    expect(ranks).toEqual({ b: 1, c: 2, a: 3, v2a: 1 });
    expect(leaderboard).toMatchObject({ hostCount: 3, leaderHostKey: HOST_B, leaderCiLowBps: 9000 });
  });

  it("re-ranks the board when a host's latest grade drops", async () => {
    const { ranks, leaderboard } = await ranksAfter(() => [grade(V1, HOST_B, 5000, 6000)]);
    expect(ranks).toEqual({ c: 1, a: 2, b: 3, v2a: 1 });
    expect(leaderboard).toMatchObject({ hostCount: 3, leaderHostKey: HOST_C, leaderCiLowBps: 7000 });
  });

  it("links a CRE attestation to the grade it re-checked", async () => {
    const indexer = createTestIndexer();
    const posted = grade(V1, HOST_A, 8000, 9000);
    await indexer.process({
      chains: {
        10143: {
          simulate: [
            posted,
            {
              contract: "CreAttestor",
              event: "GradeAttested",
              block: { number: START + 1000, timestamp: T0 + 1000 },
              params: { verifier: V1, model: MODEL, hostKey: HOST_A, t: posted.params.t, agree: true, passed: 40n, total: 50n },
            },
          ],
        },
      },
    });
    const [attestation] = await indexer.GradeAttestation.getAll();
    expect(attestation?.grade_id).toBe(`${statsId(V1, HOST_A)}-${posted.params.t}`);
    expect(attestation?.agree).toBe(true);
    await indexer.Grade.getOrThrow(attestation!.grade_id);
  });

  it("prefixes every id with the chain id", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        10143: {
          simulate: [
            { contract: "VerifierRegistry", event: "VerifierRegistered", block: { number: START }, params: { verifier: V1, agentId: 7n } },
            grade(V1, HOST_A, 8000, 9000),
            grade(V1, HOST_A, 1000, 2000),
          ],
        },
      },
    });
    const ids = [
      ...(await indexer.Verifier.getAll()),
      ...(await indexer.Grade.getAll()),
      ...(await indexer.HostModelStats.getAll()),
      ...(await indexer.DriftEvent.getAll()),
      ...(await indexer.ModelLeaderboard.getAll()),
    ].map((e) => e.id);
    expect(ids).toHaveLength(6);
    for (const id of ids) expect(id).toMatch(/^10143-/);
  });
});
