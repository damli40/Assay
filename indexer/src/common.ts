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
