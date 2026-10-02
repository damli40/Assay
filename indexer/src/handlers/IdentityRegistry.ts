import { indexer } from "envio";
import { getOrCreateAgent } from "../common.js";

// Cards are fetched later, only for agents that set a host key or register as a verifier.
indexer.onEvent({ contract: "IdentityRegistry", event: "Registered" }, async ({ event, context }) => {
  const { agentId, agentURI, owner } = event.params;
  const agent = await getOrCreateAgent(context, event.chainId, agentId);
  context.Agent.set({ ...agent, owner, agentURI, registeredBlock: event.block.number });
});
