import { indexer, type HostModelStats } from "envio";
import { withCard } from "../agentCard.js";
import { getOrCreateAgent } from "../common.js";

const fields = { transaction: ["hash"], block: ["timestamp"] } as const;

indexer.onEvent({ contract: "VerifierRegistry", event: "VerifierRegistered" }, async ({ event, context }) => {
  const { verifier, agentId } = event.params;
  const id = `${event.chainId}-${verifier}`;
  const existing = await context.Verifier.get(id);
  context.Verifier.set({
    id,
    address: verifier,
    agentId,
    registeredBlock: event.block.number,
    gradeCount: existing?.gradeCount ?? 0,
  });
  const agent = await getOrCreateAgent(context, event.chainId, agentId);
  context.Agent.set(await withCard(context, agent));
});

// Best first: higher lower bound, then higher upper bound, then hostKey so ties are stable.
function rankEntries(entries: HostModelStats[]): HostModelStats[] {
  return [...entries].sort(
    (a, b) =>
      b.latestCiLowBps - a.latestCiLowBps ||
      b.latestCiHighBps - a.latestCiHighBps ||
      a.hostKey.localeCompare(b.hostKey),
  );
}

indexer.onEvent({ contract: "VerifierRegistry", event: "GradePosted", fields }, async ({ event, context }) => {
  const p = event.params;
  const ciLowBps = Number(p.ciLowBps);
  const ciHighBps = Number(p.ciHighBps);
  const passed = Number(p.passed);
  const total = Number(p.total);
  const timestamp = event.block.timestamp;

  const verifierId = `${event.chainId}-${p.verifier}`;
  const verifier = await context.Verifier.getOrCreate({
    id: verifierId,
    address: p.verifier,
    agentId: p.verifierAgentId,
    registeredBlock: undefined,
    gradeCount: 0,
  });
  context.Verifier.set({ ...verifier, gradeCount: verifier.gradeCount + 1 });

  const leaderboardId = `${verifierId}-${p.model}`;
  const statsId = `${leaderboardId}-${p.hostKey}`;
  const gradeId = `${statsId}-${p.t}`;
  const previous = await context.HostModelStats.get(statsId);

  context.Grade.set({
    id: gradeId,
    verifier_id: verifierId,
    verifierAgentId: p.verifierAgentId,
    model: p.model,
    hostKey: p.hostKey,
    stats_id: statsId,
    passed,
    total,
    ciLowBps,
    ciHighBps,
    checks: p.checks,
    refModel: p.refModel,
    evidence: p.evidence,
    t: p.t,
    block: event.block.number,
    timestamp,
    txHash: event.transaction.hash,
  });

  const drifted = previous !== undefined && ciHighBps < previous.latestCiLowBps;
  if (drifted) {
    context.DriftEvent.set({
      id: gradeId,
      stats_id: statsId,
      verifier_id: verifierId,
      model: p.model,
      hostKey: p.hostKey,
      previous_id: previous.latest_id,
      grade_id: gradeId,
      previousCiLowBps: previous.latestCiLowBps,
      ciHighBps,
      dropBps: previous.latestCiLowBps - ciHighBps,
      t: p.t,
      timestamp,
    });
  }

  const passedSum = (previous?.passedSum ?? 0n) + p.passed;
  const totalSum = (previous?.totalSum ?? 0n) + p.total;
  const stats: HostModelStats = {
    id: statsId,
    verifier_id: verifierId,
    model: p.model,
    hostKey: p.hostKey,
    leaderboard_id: leaderboardId,
    rank: previous?.rank ?? 0,
    latest_id: gradeId,
    latestCiLowBps: ciLowBps,
    latestCiHighBps: ciHighBps,
    latestT: p.t,
    gradeCount: (previous?.gradeCount ?? 0) + 1,
    passedSum,
    totalSum,
    passRateBps: totalSum === 0n ? 0 : Number((passedSum * 10_000n) / totalSum),
    driftCount: (previous?.driftCount ?? 0) + (drifted ? 1 : 0),
  };

  // ponytail: re-ranks the whole board on every grade; fine for tens of hosts per model.
  const others = (await context.HostModelStats.getWhere({ leaderboard_id: { _eq: leaderboardId } })).filter(
    (e) => e.id !== statsId,
  );
  const ranked = rankEntries([...others, stats]);
  ranked.forEach((entry, i) => {
    if (entry === stats || entry.rank !== i + 1) context.HostModelStats.set({ ...entry, rank: i + 1 });
  });
  const leader = ranked[0]!;
  context.ModelLeaderboard.set({
    id: leaderboardId,
    verifier_id: verifierId,
    model: p.model,
    hostCount: ranked.length,
    leaderHostKey: leader.hostKey,
    leaderCiLowBps: leader.latestCiLowBps,
    updatedTimestamp: timestamp,
  });
});
