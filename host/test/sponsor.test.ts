import { reputationAbi, sponsoredCallTypedData, delegationCode } from "@assay/receipts";
import { Hono } from "hono";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { mountSponsor, type SponsorDeps, type SponsorRequest } from "../src/sponsor.js";
import { Store } from "../src/store.js";
import { tempDir } from "./helpers.js";

const CHAIN = 10143;
const AGENT = 1962n;
const ANCHOR = "0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24" as Address;
const REPUTATION = "0x8004B663056A597Dffe9eCcC1965A193B7388713" as Address;
const IMPL = "0x00000000000000000000000000000000000A55A7" as Address;
const NOW = 1_800_000_000_000;
const ANCHORED = `0x${"a1".repeat(32)}` as Hex;
const PENDING = `0x${"b2".repeat(32)}` as Hex;
const app_key = privateKeyToAccount(`0x${"a99".padStart(64, "0")}`);
const stranger = privateKeyToAccount(`0x${"b0b".padStart(64, "0")}`);

function setup(over: Partial<SponsorDeps> = {}, state: { code?: Hex; cosigned?: boolean } = {}) {
  const store = new Store(tempDir());
  for (const hash of [ANCHORED, PENDING]) store.addReceipt({ hash, body: {} as never, jws: "a.b.c" });
  store.addBatch({ root: `0x${"cc".repeat(32)}`, count: 1, anchorTx: `0x${"dd".repeat(32)}`, proofs: { [ANCHORED]: [] }, anchoredAt: 1 });
  const sent: SponsorRequest[] = [];
  const app = new Hono();
  mountSponsor(app, {
    chainId: CHAIN,
    agentId: AGENT,
    anchor: ANCHOR,
    reputation: REPUTATION,
    accountImpl: IMPL,
    store,
    code: async () => state.code,
    cosignedK: async () => state.cosigned ?? false,
    send: async (req) => {
      sent.push(req);
      return `0x${"ee".repeat(32)}`;
    },
    now: () => NOW,
    ...over,
  });
  const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { post, sent };
}

const feedbackData = (agentId = AGENT, hash: Hex = ANCHORED, text = "") =>
  encodeFunctionData({ abi: reputationAbi, functionName: "giveFeedback", args: [agentId, -100n, 0, "assay", text || "receipt", "", "", hash] });

async function feedbackBody(opts: { data?: Hex; signer?: typeof app_key; auth?: boolean | "stranger"; deadline?: bigint } = {}) {
  const data = opts.data ?? feedbackData();
  const call = { target: REPUTATION, data, nonce: 42n, deadline: opts.deadline ?? BigInt(NOW / 1000 + 600) };
  const signature = await (opts.signer ?? app_key).signTypedData(sponsoredCallTypedData(CHAIN, app_key.address, call));
  const authBy = opts.auth === "stranger" ? stranger : app_key;
  const a = opts.auth ? await authBy.signAuthorization({ chainId: CHAIN, address: IMPL, nonce: 0 }) : undefined;
  return {
    account: app_key.address,
    call: { data, nonce: "42", deadline: String(call.deadline), signature },
    ...(a ? { authorization: { address: a.address, chainId: a.chainId, nonce: a.nonce, r: a.r, s: a.s, yParity: a.yParity } } : {}),
  };
}

describe("POST /v1/sponsor/cosignk", () => {
  it("relays cosignK for an anchored receipt of this host, with its proof and root", async () => {
    const { post, sent } = setup();
    const signature = await app_key.signMessage({ message: { raw: ANCHORED } });
    const res = await post("/v1/sponsor/cosignk", { receiptHash: ANCHORED, signature });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ signer: app_key.address });
    expect(sent[0]).toMatchObject({ address: ANCHOR, functionName: "cosignK", args: [AGENT, ANCHORED, [], `0x${"cc".repeat(32)}`, signature] });
  });

  it("refuses receipts it didn't issue, receipts not anchored yet, repeats and bad bodies", async () => {
    const { post, sent } = setup({}, { cosigned: true });
    const sig = (h: Hex) => app_key.signMessage({ message: { raw: h } });
    expect((await post("/v1/sponsor/cosignk", { receiptHash: `0x${"00".repeat(32)}`, signature: await sig(ANCHORED) })).status).toBe(404);
    expect((await post("/v1/sponsor/cosignk", { receiptHash: PENDING, signature: await sig(PENDING) })).status).toBe(409);
    expect((await post("/v1/sponsor/cosignk", { receiptHash: ANCHORED, signature: await sig(ANCHORED) })).status).toBe(409);
    expect((await post("/v1/sponsor/cosignk", { receiptHash: ANCHORED, signature: "0x12" })).status).toBe(400);
    expect(sent).toHaveLength(0);
  });
});

describe("POST /v1/sponsor/feedback", () => {
  it("first use: installs the 7702 delegation and calls execute from the per-app address", async () => {
    const { post, sent } = setup({}, { cosigned: true });
    const res = await post("/v1/sponsor/feedback", await feedbackBody({ auth: true }));
    expect(res.status).toBe(200);
    expect(sent[0].address).toBe(app_key.address);
    expect(sent[0].functionName).toBe("execute");
    expect(sent[0].args[0]).toBe(REPUTATION);
    expect(sent[0].authorizationList).toHaveLength(1);
  });

  it("an account already delegated to AssayAccount needs no authorization", async () => {
    const { post, sent } = setup({}, { cosigned: true, code: delegationCode(IMPL) });
    expect((await post("/v1/sponsor/feedback", await feedbackBody())).status).toBe(200);
    expect(sent[0].authorizationList).toBeUndefined();
  });

  it("only sponsors receipt-backed feedback: the account must have co-signed the cited receipt", async () => {
    const { post, sent } = setup({}, { cosigned: false });
    const res = await post("/v1/sponsor/feedback", await feedbackBody({ auth: true }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error.message).toMatch(/co-sign the receipt/);
    expect(sent).toHaveLength(0);
  });

  it("refuses feedback about another agent, about an unknown receipt, or with long text", async () => {
    const { post } = setup({}, { cosigned: true });
    expect((await post("/v1/sponsor/feedback", await feedbackBody({ data: feedbackData(7n), auth: true }))).status).toBe(400);
    expect((await post("/v1/sponsor/feedback", await feedbackBody({ data: feedbackData(AGENT, `0x${"00".repeat(32)}`), auth: true }))).status).toBe(404);
    expect((await post("/v1/sponsor/feedback", await feedbackBody({ data: feedbackData(AGENT, ANCHORED, "x".repeat(201)), auth: true }))).status).toBe(400);
  });

  it("refuses a call signed by someone else, an authorization from someone else, and a missing one", async () => {
    const { post, sent } = setup({}, { cosigned: true });
    expect((await post("/v1/sponsor/feedback", await feedbackBody({ signer: stranger, auth: true }))).status).toBe(400);
    expect((await post("/v1/sponsor/feedback", await feedbackBody({ auth: "stranger" }))).status).toBe(400);
    expect((await post("/v1/sponsor/feedback", await feedbackBody({ auth: false }))).status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("refuses an account running other code, a far deadline, and a host without AssayAccount", async () => {
    const other = setup({}, { cosigned: true, code: delegationCode("0x000000000000000000000000000000000000bEEF") });
    expect((await other.post("/v1/sponsor/feedback", await feedbackBody())).status).toBe(409);
    const { post } = setup({}, { cosigned: true });
    expect((await post("/v1/sponsor/feedback", await feedbackBody({ auth: true, deadline: BigInt(NOW / 1000 + 7200) }))).status).toBe(400);
    const off = setup({ accountImpl: undefined }, { cosigned: true });
    expect((await off.post("/v1/sponsor/feedback", await feedbackBody({ auth: true }))).status).toBe(503);
  });

  it("is rate limited per client", async () => {
    const { post } = setup({}, { cosigned: true });
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await post("/v1/sponsor/cosignk", {})).status;
    expect(last).toBe(429);
  });
});
