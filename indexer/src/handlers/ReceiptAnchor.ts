/*
 * Please refer to https://docs.envio.dev for a thorough guide on all Envio indexer features
 */
import { indexer } from "envio";
import type {
  ReceiptAnchor_Anchored,
  ReceiptAnchor_Cosigned,
  ReceiptAnchor_HostKeySet,
} from "envio";

indexer.onEvent({ contract: "ReceiptAnchor", event: "Anchored" }, async ({ event, context }) => {
  const entity: ReceiptAnchor_Anchored = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
    root: event.params.root,
    count: event.params.count,
    keyHash: event.params.keyHash,
  };

  context.ReceiptAnchor_Anchored.set(entity);
});

indexer.onEvent({ contract: "ReceiptAnchor", event: "Cosigned" }, async ({ event, context }) => {
  const entity: ReceiptAnchor_Cosigned = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    receiptHash: event.params.receiptHash,
    requesterKey: event.params.requesterKey,
    agentId: event.params.agentId,
    root: event.params.root,
  };

  context.ReceiptAnchor_Cosigned.set(entity);
});

indexer.onEvent({ contract: "ReceiptAnchor", event: "HostKeySet" }, async ({ event, context }) => {
  const entity: ReceiptAnchor_HostKeySet = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
    keyHash: event.params.keyHash,
    qx: event.params.qx,
    qy: event.params.qy,
  };

  context.ReceiptAnchor_HostKeySet.set(entity);
});
