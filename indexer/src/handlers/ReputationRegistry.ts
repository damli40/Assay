import { indexer } from "envio";
import { getOrCreateAgent } from "../common.js";

const fields = { transaction: ["hash"], block: ["timestamp"] } as const;
const feedbackId = (chainId: number, agentId: bigint, client: string, index: bigint) => `${chainId}-${agentId}-${client}-${index}`;

indexer.onEvent({ contract: "ReputationRegistry", event: "NewFeedback", fields }, async ({ event, context }) => {
  const p = event.params;
  const agent = await getOrCreateAgent(context, event.chainId, p.agentId);
  // D26: backed only if this sender co-signed (cosignK) the receipt named in feedbackHash.
  const cosign = await context.Cosign.get(`${event.chainId}-${p.feedbackHash}-${p.clientAddress}`);
  const backed = cosign !== undefined && cosign.kind === "K" && cosign.agent_id === agent.id;

  context.Feedback.set({
    id: feedbackId(event.chainId, p.agentId, p.clientAddress, p.feedbackIndex),
    agent_id: agent.id,
    client: p.clientAddress,
    feedbackIndex: p.feedbackIndex,
    value: p.value,
    valueDecimals: Number(p.valueDecimals),
    tag1: p.tag1,
    tag2: p.tag2,
    endpoint: p.endpoint,
    feedbackURI: p.feedbackURI,
    feedbackHash: p.feedbackHash,
    receiptBacked: backed,
    cosign_id: backed ? cosign!.id : undefined,
    revoked: false,
    hostResponseURI: undefined,
    hostResponseHash: undefined,
    block: event.block.number,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
  context.Agent.set({
    ...agent,
    feedbackCount: agent.feedbackCount + 1,
    receiptBackedFeedbackCount: agent.receiptBackedFeedbackCount + (backed ? 1 : 0),
    receiptBackedNegativeCount: agent.receiptBackedNegativeCount + (backed && p.value < 0n ? 1 : 0),
  });
});

indexer.onEvent({ contract: "ReputationRegistry", event: "FeedbackRevoked" }, async ({ event, context }) => {
  const p = event.params;
  const f = await context.Feedback.get(feedbackId(event.chainId, p.agentId, p.clientAddress, p.feedbackIndex));
  if (!f || f.revoked) return;
  context.Feedback.set({ ...f, revoked: true });
  const agent = await getOrCreateAgent(context, event.chainId, p.agentId);
  context.Agent.set({
    ...agent,
    receiptBackedFeedbackCount: agent.receiptBackedFeedbackCount - (f.receiptBacked ? 1 : 0),
    receiptBackedNegativeCount: agent.receiptBackedNegativeCount - (f.receiptBacked && f.value < 0n ? 1 : 0),
  });
});

// Anyone may append a response; only the agent owner's counts as the host's reply.
indexer.onEvent({ contract: "ReputationRegistry", event: "ResponseAppended" }, async ({ event, context }) => {
  const p = event.params;
  const f = await context.Feedback.get(feedbackId(event.chainId, p.agentId, p.clientAddress, p.feedbackIndex));
  const agent = await context.Agent.get(`${event.chainId}-${p.agentId}`);
  if (!f || !agent?.owner || agent.owner !== p.responder) return;
  context.Feedback.set({ ...f, hostResponseURI: p.responseURI, hostResponseHash: p.responseHash });
});
