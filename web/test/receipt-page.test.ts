// @vitest-environment happy-dom
import { receiptHash, type ReceiptBody } from "@assay/receipts";
import type { Hex } from "viem";
import { describe, expect, it, vi } from "vitest";
import { anchorInfo, indexedAnchor, type AnchorReader } from "../src/lib/indexer.js";
import { parseHash } from "../src/router.js";
import { mountReceipt, renderAnchorCard, type ReceiptDeps } from "../src/views/receipt.js";

// The first live receipt (host 1962, 3 Oct, block 67577033).
const body: ReceiptBody = {
  v: "assay-receipt/0",
  model: "gemma-4-31b-it",
  host: { agentId: "erc8004:10143:1962", keyId: "2Jc6WJSjvNSL7jid_XaVkG4iVOIBr7HSqhk1KiF5qg0", alg: "ES256" },
  req: { commit: "0xca4a1369a38c874af529faddbb78364211783e3d61b90d130dcc40971fc7bcfa", params: { max_tokens: 256, temperature: 0 } },
  res: { commit: "0x697971df402c5b6990e5e0730c135bcb6f0bf69b3760f6829011f0c98b025da8", tokensIn: 3, tokensOut: 1, finish: "stop" },
  t: 1790954324495,
  nonce: "0xe0fda87441b9ba12ddf9bfe2ac21c71b",
};
const hash = receiptHash(body);
const root: Hex = "0x8c89bd8a6495777123457221aae3a0ecf237dd6bd057b404a034ae4acdabbab2";
const tx: Hex = "0x41f73bcaa5270d16df2cbdafc920b0fa7f6e87890f968acece7f3c6a99a7a867";
const keyHash = "0x6c73fb3eca37810218b75460eb99a7aede153cf3ec8858a6dca1c06a1153a68e";
const cast = `cast call 0x63e4 "verifyReceipt(uint256,bytes32,bytes32[],bytes32)(bool)" 1962 ${hash} "[]" ${root} --rpc-url https://testnet-rpc.monad.xyz`;

const gql = (data: unknown) => vi.fn(async () => new Response(JSON.stringify({ data }), { status: 200 })) as unknown as typeof fetch;
const indexed = { Anchor: [{ count: 1, block: 67577033, txHash: tx, agent: { name: "Assay reference host" }, hostKey: { keyHash } }], Cosign: [] };

const client: AnchorReader = {
  async readContract({ functionName }) {
    if (functionName === "anchors") return [1, 1790954339n];
    if (functionName === "hostKeys") return [`0x${"11".repeat(32)}`, `0x${"22".repeat(32)}`];
    if (functionName === "keyHashOf") return keyHash;
    return false;
  },
  async getTransactionReceipt() {
    return { blockNumber: 67577033n };
  },
};

function deps(over: Partial<ReceiptDeps>): ReceiptDeps {
  return {
    status: async () => ({ status: "anchored", body, jws: "a.b.c", root, proof: [], anchorTx: tx, reproduce: { cast } }),
    jwks: async () => ({ keys: [] }),
    chain: () => ({
      client,
      anchor: (o) => anchorInfo({ ...o, client, anchor: "0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24", indexer: (a, r, h) => indexedAnchor(a, r, h, "https://idx.example", gql(indexed)) }),
      grade: async () => null,
    }),
    ...over,
  };
}

const mount = (d: ReceiptDeps) => {
  const el = document.createElement("main");
  mountReceipt(el, parseHash(`#r/${hash}`), d);
  return el;
};

describe("indexer", () => {
  it("reads the batch and its signing key in one GraphQL call", async () => {
    const f = gql(indexed);
    const info = await indexedAnchor(1962n, root, hash, "https://idx.example", f);
    expect(info).toMatchObject({ count: 1, block: 67577033, txHash: tx, keyHash, source: "indexer", cosigns: [] });
    const sent = JSON.parse((f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1].body as string);
    expect(sent.variables).toEqual({ id: `10143-1962-${root}`, hash });
  });

  it("falls back to RPC and labels the key as current when the indexer is down", async () => {
    const info = await anchorInfo({ agentId: 1962n, root, receiptHash: hash, anchorTx: tx, client, anchor: "0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24", indexer: async () => { throw new Error("down"); } });
    expect(info).toMatchObject({ count: 1, block: 67577033, keyHash, source: "rpc" });
    expect(renderAnchorCard(info, root).textContent).toContain("Current key");
  });
});

describe("receipt page", () => {
  it("renders a host 404 as the unknown state, not an error", async () => {
    const el = mount(deps({ status: async () => { throw Object.assign(new Error("HTTP 404"), { status: 404 }); } }));
    await vi.waitFor(() => expect(el.textContent).toContain("This host doesn't know that receipt"));
    expect(el.textContent).not.toContain("HTTP 404");
  });

  it("shows a pending receipt at level 0 not reached, with no body when this browser has no copy", async () => {
    const el = mount(deps({ status: async () => ({ status: "pending" }) }));
    await vi.waitFor(() => expect(el.querySelector('[data-level="0"]')).not.toBeNull());
    expect(el.querySelector('[data-level="0"]')!.classList.contains("notreached")).toBe(true);
    expect(el.textContent).toContain("Waiting for batch");
    expect(el.textContent).not.toContain("What the host signed");
  });

  it("shows the anchor from the indexer, the host's cast line and the exact signed body", async () => {
    const el = mount(deps({}));
    await vi.waitFor(() => expect(el.querySelector(".anchor-card")).not.toBeNull());
    const card = el.querySelector(".anchor-card")!;
    expect(card.querySelector("[data-source]")!.getAttribute("data-source")).toBe("indexer");
    expect(card.textContent).toContain("67577033");
    expect(card.querySelector(`[title="${keyHash}"]`)).not.toBeNull();
    expect(card.querySelector(".repro pre")!.textContent).toBe(cast);
    expect(card.querySelector(".repro .copy")).not.toBeNull();
    expect(el.querySelector("pre.raw")!.textContent).toBe(JSON.stringify(body, null, 2));
    expect(el.querySelector('[data-check="outputCommit"] .badge')!.textContent).toBe("Needs salt");
    expect(el.querySelector("h1")!.textContent).toBe("Served by agent 1962, claiming gemma-4-31b-it");
    expect(hash).toBe("0x9a166cacb2ffe4784ad556f69b690b7cebf71150f737a5a3c324f9e98e7907e5");
  });

  it("says so when a receipt comes from a chain the app doesn't know", async () => {
    const foreign = { ...body, host: { ...body.host, agentId: "erc8004:999:1" } };
    const el = mount(deps({ status: async () => ({ status: "anchored", body: foreign, jws: "a.b.c", root, proof: [] }) }));
    await vi.waitFor(() => expect(el.textContent).toContain("chain 999, which this app doesn't know"));
  });
});
