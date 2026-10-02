import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestIndexer } from "envio";

const OWNER = "0x00000000000000000000000000000000000000aa" as `0x${string}`;
const KEY = `0x${"a".repeat(64)}`;
const START = 67_463_000;
const card = { type: "agent", name: "Assay host", description: "Signed receipts", services: [{ name: "A2A", endpoint: "https://h.example" }] };

function run(agentId: bigint, agentURI: string) {
  const indexer = createTestIndexer();
  return indexer
    .process({
      chains: {
        10143: {
          simulate: [
            { contract: "IdentityRegistry", event: "Registered", block: { number: START }, params: { agentId, agentURI, owner: OWNER } },
            {
              contract: "ReceiptAnchor",
              event: "HostKeySet",
              block: { number: START + 1 },
              params: { agentId, keyHash: KEY, qx: KEY, qy: KEY },
            },
          ],
        },
      },
    })
    .then(() => indexer);
}

afterEach(() => vi.unstubAllGlobals());

describe("Agent cards", () => {
  it("reads a data: URI card without a network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const uri = `data:application/json;base64,${Buffer.from(JSON.stringify(card)).toString("base64")}`;
    const indexer = await run(1962n, uri);

    expect(await indexer.Agent.getOrThrow("10143-1962")).toMatchObject({
      owner: OWNER,
      agentURI: uri,
      registeredBlock: START,
      cardStatus: "OK",
      name: "Assay host",
      description: "Signed receipts",
      services: card.services,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches an ipfs card through the gateway", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(card)));
    vi.stubGlobal("fetch", fetchMock);
    const indexer = await run(2001n, "ipfs://bafy-card-2001");

    expect((await indexer.Agent.getOrThrow("10143-2001")).name).toBe("Assay host");
    expect(fetchMock).toHaveBeenCalledWith("https://ipfs.io/ipfs/bafy-card-2001", expect.anything());
  });

  it("keeps indexing when the card fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("down"))));
    const indexer = await run(2002n, "https://cards.example/2002.json");

    expect(await indexer.Agent.getOrThrow("10143-2002")).toMatchObject({ cardStatus: "ERROR", name: undefined });
    expect((await indexer.HostKey.getOrThrow(`10143-2002-${KEY}`)).active).toBe(true);
  });

  it.each([
    [2003n, "<html>"],
    [2005n, "[1]"],
  ])("marks a card that is not a JSON object as an error (agent %s)", async (agentId, body) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    const indexer = await run(agentId, `https://cards.example/${agentId}.json`);
    expect((await indexer.Agent.getOrThrow(`10143-${agentId}`)).cardStatus).toBe("ERROR");
  });

  it("skips plain http URIs", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const indexer = await run(2004n, "http://10.0.0.1/card.json");

    expect((await indexer.Agent.getOrThrow("10143-2004")).cardStatus).toBe("UNSUPPORTED");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
