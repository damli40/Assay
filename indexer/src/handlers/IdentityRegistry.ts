import { indexer } from "envio";
import { clean, getOrCreateAgent } from "../common.js";

// Cards are fetched later, only for agents that set a host key or register as a verifier.
indexer.onEvent({ contract: "IdentityRegistry", event: "Registered" }, async ({ event, context }) => {
  const { agentId, agentURI, owner } = event.params;
  const agent = await getOrCreateAgent(context, event.chainId, agentId);
  // Data URIs carry the whole card, so the cap is the card limit, not a URL length.
  context.Agent.set({ ...agent, owner, agentURI: clean(agentURI, 96 * 1024), registeredBlock: event.block.number });
});
