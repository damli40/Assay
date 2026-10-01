import { indexer, type EvmOnEventContext } from "envio";
import { bumpActivity, getOrCreateAgent } from "../common.js";

const fields = { transaction: ["hash"], block: ["timestamp"] } as const;

indexer.onEvent({ contract: "ReceiptAnchor", event: "HostKeySet", fields }, async ({ event, context }) => {
  const { agentId, keyHash, qx, qy } = event.params;
  const agent = await getOrCreateAgent(context, event.chainId, agentId);
  const keyId = `${agent.id}-${keyHash}`;
  if (agent.currentKey_id === keyId) return;

  const previous = agent.currentKey_id ? await context.HostKey.get(agent.currentKey_id) : undefined;
  if (previous) context.HostKey.set({ ...previous, active: false, retiredBlock: event.block.number });

  // A host can switch back to an older key; keep its counters.
  const existing = await context.HostKey.get(keyId);
  context.HostKey.set({
    id: keyId,
    agent_id: agent.id,
    keyHash,
    qx,
    qy,
    active: true,
    setBlock: event.block.number,
    setTimestamp: event.block.timestamp,
    retiredBlock: undefined,
    anchorCount: existing?.anchorCount ?? 0,
    receiptCount: existing?.receiptCount ?? 0,
  });
  context.KeyRotation.set({
    id: `${agent.id}-${event.block.number}-${event.logIndex}`,
    agent_id: agent.id,
    fromKey_id: previous?.id,
    toKey_id: keyId,
    anchorsUnderFromKey: previous?.anchorCount ?? 0,
    block: event.block.number,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
  context.Agent.set({ ...agent, currentKey_id: keyId, keyCount: agent.keyCount + (existing ? 0 : 1) });
});

indexer.onEvent({ contract: "ReceiptAnchor", event: "Anchored", fields }, async ({ event, context }) => {
  const { agentId, root, keyHash } = event.params;
  const count = Number(event.params.count);
  const agent = await getOrCreateAgent(context, event.chainId, agentId);
  const keyId = `${agent.id}-${keyHash}`;

  context.Anchor.set({
    id: `${agent.id}-${root}`,
    agent_id: agent.id,
    hostKey_id: keyId,
    root,
    count,
    cosignCount: 0,
    block: event.block.number,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
  const key = await context.HostKey.get(keyId);
  if (key) context.HostKey.set({ ...key, anchorCount: key.anchorCount + 1, receiptCount: key.receiptCount + count });
  context.Agent.set({ ...agent, anchorCount: agent.anchorCount + 1, receiptCount: agent.receiptCount + count });
  await bumpActivity(context, agent, event.block.timestamp, { anchors: 1, receipts: count });
});

async function recordCosign(
  context: EvmOnEventContext,
  event: { chainId: number; block: { number: number; timestamp: number }; transaction: { hash: string } },
  kind: "P256" | "K",
  receiptHash: string,
  requester: string,
  agentId: bigint,
  root: string,
) {
  const agent = await getOrCreateAgent(context, event.chainId, agentId);
  const anchorId = `${agent.id}-${root}`;

  context.Cosign.set({
    id: `${event.chainId}-${receiptHash}-${requester}`,
    kind,
    receiptHash,
    requester,
    agent_id: agent.id,
    anchor_id: anchorId,
    block: event.block.number,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
  const anchor = await context.Anchor.get(anchorId);
  if (anchor) context.Anchor.set({ ...anchor, cosignCount: anchor.cosignCount + 1 });
  context.Agent.set({ ...agent, cosignCount: agent.cosignCount + 1 });
  await bumpActivity(context, agent, event.block.timestamp, { cosigns: 1 });
}

indexer.onEvent({ contract: "ReceiptAnchor", event: "Cosigned", fields }, async ({ event, context }) => {
  const { receiptHash, requesterKey, agentId, root } = event.params;
  await recordCosign(context, event, "P256", receiptHash, requesterKey, agentId, root);
});

indexer.onEvent({ contract: "ReceiptAnchor", event: "CosignedK", fields }, async ({ event, context }) => {
  const { receiptHash, signer, agentId, root } = event.params;
  await recordCosign(context, event, "K", receiptHash, signer, agentId, root);
});
