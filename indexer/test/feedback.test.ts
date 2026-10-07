import { describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";

const AGENT = 1962n;
const OWNER = "0x00000000000000000000000000000000000000bb";
const SIGNER = "0x00000000000000000000000000000000000000aa";
const STRANGER = "0x00000000000000000000000000000000000000cc";
const RECEIPT = `0x${"e".repeat(64)}`;
const ROOT = `0x${"1".repeat(64)}`;
const T = 1_791_000_000;
const START = 67_463_000;

const registered = (n: number) =>
  ({ contract: "IdentityRegistry", event: "Registered", block: { number: START + n }, params: { agentId: AGENT, agentURI: "", owner: OWNER } }) as const;
const cosignK = (n: number, signer: string, agentId = AGENT) =>
  ({
    contract: "ReceiptAnchor",
    event: "CosignedK",
    block: { number: START + n, timestamp: T + n },
    params: { receiptHash: RECEIPT, signer, agentId, root: ROOT },
  }) as const;
const feedback = (n: number, client: string, value: bigint, index = 1n) =>
  ({
    contract: "ReputationRegistry",
    event: "NewFeedback",
    block: { number: START + n, timestamp: T + n },
    params: {
      agentId: AGENT,
      clientAddress: client,
      feedbackIndex: index,
      value,
      valueDecimals: 0n,
      indexedTag1: "assay-receipt",
      tag1: "assay-receipt",
      tag2: "google/gemma-4-31b-it:free",
      endpoint: "https://host.example",
      feedbackURI: "",
      feedbackHash: RECEIPT,
    },
  }) as const;

async function run(simulate: readonly unknown[]) {
  const indexer = createTestIndexer();
  await indexer.process({ chains: { 10143: { simulate: simulate as never } } });
  return indexer;
}

describe("Receipt-backed feedback (D26)", () => {
  it("backs feedback from the address that co-signed the receipt and counts the complaint", async () => {
    const ix = await run([registered(0), cosignK(1, SIGNER), feedback(2, SIGNER, -1n)]);
    const f = await ix.Feedback.getOrThrow(`10143-1962-${SIGNER}-1`);
    expect(f).toMatchObject({ receiptBacked: true, cosign_id: `10143-${RECEIPT}-${SIGNER}`, revoked: false, value: -1n });
    expect(await ix.Agent.getOrThrow("10143-1962")).toMatchObject({ feedbackCount: 1, receiptBackedFeedbackCount: 1, receiptBackedNegativeCount: 1 });
  });

  it("does not back feedback from someone who never co-signed", async () => {
    const ix = await run([registered(0), cosignK(1, SIGNER), feedback(2, STRANGER, -1n)]);
    expect(await ix.Feedback.getOrThrow(`10143-1962-${STRANGER}-1`)).toMatchObject({ receiptBacked: false });
    expect(await ix.Agent.getOrThrow("10143-1962")).toMatchObject({ feedbackCount: 1, receiptBackedFeedbackCount: 0, receiptBackedNegativeCount: 0 });
  });

  it("does not back feedback citing a receipt anchored by another host", async () => {
    const ix = await run([registered(0), cosignK(1, SIGNER, 7n), feedback(2, SIGNER, -1n)]);
    expect(await ix.Feedback.getOrThrow(`10143-1962-${SIGNER}-1`)).toMatchObject({ receiptBacked: false });
  });

  it("counts positive backed feedback without counting it as a complaint", async () => {
    const ix = await run([registered(0), cosignK(1, SIGNER), feedback(2, SIGNER, 1n)]);
    expect(await ix.Agent.getOrThrow("10143-1962")).toMatchObject({ receiptBackedFeedbackCount: 1, receiptBackedNegativeCount: 0 });
  });

  it("removes revoked feedback from the counts", async () => {
    const ix = await run([
      registered(0),
      cosignK(1, SIGNER),
      feedback(2, SIGNER, -1n),
      { contract: "ReputationRegistry", event: "FeedbackRevoked", block: { number: START + 3 }, params: { agentId: AGENT, clientAddress: SIGNER, feedbackIndex: 1n } },
    ]);
    expect(await ix.Feedback.getOrThrow(`10143-1962-${SIGNER}-1`)).toMatchObject({ revoked: true });
    expect(await ix.Agent.getOrThrow("10143-1962")).toMatchObject({ receiptBackedFeedbackCount: 0, receiptBackedNegativeCount: 0 });
  });

  it("records the agent owner's reply and ignores replies from anyone else", async () => {
    const reply = (n: number, responder: string, uri: string) =>
      ({
        contract: "ReputationRegistry",
        event: "ResponseAppended",
        block: { number: START + n },
        params: { agentId: AGENT, clientAddress: SIGNER, feedbackIndex: 1n, responder, responseURI: uri, responseHash: RECEIPT },
      }) as const;
    const ix = await run([registered(0), cosignK(1, SIGNER), feedback(2, SIGNER, -1n), reply(3, OWNER, "ipfs://reply"), reply(4, STRANGER, "ipfs://spam")]);
    expect(await ix.Feedback.getOrThrow(`10143-1962-${SIGNER}-1`)).toMatchObject({ hostResponseURI: "ipfs://reply" });
  });
});

// Postgres rejects NUL in text and jsonb, and a rejected write stops the indexer. Strangers write to the shared registries.
describe("Strings from the shared ERC-8004 registries", () => {
  it("are stored without NUL characters and with a length cap", async () => {
    const nul = "evil\u0000uri";
    const reg = { ...registered(0), params: { ...registered(0).params, agentURI: `data:,${nul}` } };
    const fb = feedback(1, STRANGER, -1n);
    const ix = await run([reg, { ...fb, params: { ...fb.params, tag2: nul, endpoint: "x".repeat(5000), feedbackURI: nul } }]);
    const agent = await ix.Agent.getOrThrow("10143-1962");
    expect(agent.agentURI).toBe("data:,eviluri");
    const f = await ix.Feedback.getOrThrow(`10143-1962-${STRANGER}-1`);
    expect(f.tag2).toBe("eviluri");
    expect(f.feedbackURI).toBe("eviluri");
    expect(f.endpoint).toHaveLength(2000);
  });
});
