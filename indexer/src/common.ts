import type { Agent, EvmOnEventContext, HostActivity } from "envio";

export const agentEntityId = (chainId: number, agentId: bigint) => `${chainId}-${agentId}`;

export const utcDay = (timestamp: number) => new Date(timestamp * 1000).toISOString().slice(0, 10);

export async function getOrCreateAgent(context: EvmOnEventContext, chainId: number, agentId: bigint): Promise<Agent> {
  return context.Agent.getOrCreate({
    id: agentEntityId(chainId, agentId),
    agentId,
    owner: undefined,
    agentURI: undefined,
    registeredBlock: undefined,
    cardStatus: undefined,
    name: undefined,
    description: undefined,
    image: undefined,
    services: undefined,
    currentKey_id: undefined,
    keyCount: 0,
    anchorCount: 0,
    receiptCount: 0,
    cosignCount: 0,
    feedbackCount: 0,
    receiptBackedFeedbackCount: 0,
    receiptBackedNegativeCount: 0,
  });
}

export async function bumpActivity(
  context: EvmOnEventContext,
  agent: Agent,
  timestamp: number,
  add: { anchors?: number; receipts?: number; cosigns?: number },
): Promise<void> {
  const day = utcDay(timestamp);
  const current: HostActivity = await context.HostActivity.getOrCreate({
    id: `${agent.id}-${day}`,
    agent_id: agent.id,
    day,
    anchors: 0,
    receipts: 0,
    cosigns: 0,
  });
  context.HostActivity.set({
    ...current,
    anchors: current.anchors + (add.anchors ?? 0),
    receipts: current.receipts + (add.receipts ?? 0),
    cosigns: current.cosigns + (add.cosigns ?? 0),
  });
}

/// Postgres text and jsonb reject the NUL character, and one rejected write stops the whole indexer. The ERC-8004
/// registries are shared, so strangers choose these strings: strip NUL and cap the length before storing them.
export function clean(s: string, max = 2000): string {
  return s.replace(/\u0000/g, "").slice(0, max);
}

/// The same for JSON from agent cards: every string inside, keys included, loses its NULs.
export function cleanJson(v: unknown): unknown {
  if (typeof v === "string") return clean(v, 4000);
  if (Array.isArray(v)) return v.slice(0, 50).map(cleanJson);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).slice(0, 50).map(([k, x]) => [clean(k, 200), cleanJson(x)]));
  return v;
}
