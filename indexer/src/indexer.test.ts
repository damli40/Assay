import { describe, it } from "vitest";
import { createTestIndexer, type ReceiptAnchor_Anchored } from "envio";

describe("ReceiptAnchor contract Anchored event tests", () => {
  it("ReceiptAnchor_Anchored is created correctly", async (t) => {
    const indexer = createTestIndexer();

    // Creating mock for ReceiptAnchor contract Anchored event
    const event = {
      contract: "ReceiptAnchor" as const,
      event: "Anchored" as const,
      params: {
        agentId: 0n,
        root: "0x00",
        count: 0n,
        keyHash: "0x00",
      },
    };

    await indexer.process({
      chains: {
        10143: {
          simulate: [event],
        },
      },
    });

    // Getting the actual entity from the test indexer
    const actualReceiptAnchorAnchored = await indexer.ReceiptAnchor_Anchored.getOrThrow("10143_67269630_0");

    // Creating the expected entity
    const expectedReceiptAnchorAnchored = {
      id: "10143_67269630_0",
      agentId: event.params.agentId,
      root: event.params.root,
      count: event.params.count,
      keyHash: event.params.keyHash,
      chainId: 10143,
    };
    // Asserting that the entity in the mock database is the same as the expected entity
    t.expect(actualReceiptAnchorAnchored, "Actual ReceiptAnchorAnchored should be the same as the expected ReceiptAnchorAnchored").toEqual(expectedReceiptAnchorAnchored);
  });
});
