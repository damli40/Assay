import { S, createEffect, type Agent, type EvmOnEventContext } from "envio";
import { clean, cleanJson } from "./common.js";

const MAX_CARD_BYTES = 64 * 1024;

// Returns the card body, or undefined on any failure (not cached, so the next lookup retries).
export const fetchCard = createEffect(
  {
    name: "fetchAgentCard",
    input: S.string,
    output: S.optional(S.string),
    cache: true,
    rateLimit: { calls: 5, per: "second" },
  },
  async ({ input: url, context }) => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const text = res.ok ? await res.text() : undefined;
      if (text !== undefined && text.length <= MAX_CARD_BYTES) return text;
    } catch {
      // fall through
    }
    context.cache = false;
    return undefined;
  },
);

// Only https and ipfs are fetched: agentURI is set by anyone, so plain http and other schemes are skipped.
export function cardUrl(uri: string): string | undefined {
  if (uri.startsWith("https://")) return uri;
  if (uri.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${uri.slice("ipfs://".length)}`;
  return undefined;
}

function decodeDataUri(uri: string): string | undefined {
  const comma = uri.indexOf(",");
  if (comma < 0) return undefined;
  const payload = uri.slice(comma + 1);
  try {
    return uri.slice(0, comma).endsWith(";base64")
      ? Buffer.from(payload, "base64").toString("utf8")
      : decodeURIComponent(payload);
  } catch {
    return undefined;
  }
}

const text = (v: unknown) => (typeof v === "string" ? clean(v, 1000) : undefined);

function parseCard(body: string) {
  try {
    const card: unknown = JSON.parse(body);
    if (typeof card !== "object" || card === null || Array.isArray(card)) return undefined;
    const c = card as Record<string, unknown>;
    return { name: text(c.name), description: text(c.description), image: text(c.image), services: cleanJson(c.services ?? c.endpoints) };
  } catch {
    return undefined;
  }
}

// Returns the agent with card fields filled in; the caller sets it. A loaded card is never re-fetched.
export async function withCard(context: EvmOnEventContext, agent: Agent): Promise<Agent> {
  const uri = agent.agentURI;
  if (!uri || agent.cardStatus === "OK") return agent;

  let body: string | undefined;
  if (uri.startsWith("data:")) {
    body = decodeDataUri(uri);
  } else {
    const url = cardUrl(uri);
    if (!url) return { ...agent, cardStatus: "UNSUPPORTED" };
    body = await context.effect(fetchCard, url);
  }
  const card = body === undefined ? undefined : parseCard(body);
  return card ? { ...agent, ...card, cardStatus: "OK" } : { ...agent, cardStatus: "ERROR" };
}
