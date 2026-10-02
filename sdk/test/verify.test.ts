import { createHash, webcrypto } from "node:crypto";
import type { JWK } from "jose";
import type { Hex } from "viem";
import { describe, expect, it } from "vitest";
import { commitRequest, commitResponse, newSalt } from "../src/commit.js";
import { createHostSigner } from "../src/hostSigner.js";
import { buildBatch } from "../src/merkle.js";
import { buildReceipt, receiptHash, type ReceiptBody } from "../src/receipt.js";
import { parseAgentId, verifyReceipt, type Checks, type ContractReader, type VerifyInput } from "../src/verify.js";

const ANCHOR = "0x049A73755cA3508ef3Daa4752A3406f6e00CfB13";
const KEY_ID = "host-key-2026-10";
const COSIGNER = ("0x" + "cd".repeat(32)) as Hex;
const random32 = () => ("0x" + Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString("hex")) as Hex;

async function privateJwk(): Promise<JWK> {
  const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  return (await webcrypto.subtle.exportKey("jwk", pair.privateKey)) as JWK;
}

// A chain where `root` is anchored by agent 1962 and COSIGNER co-signed `hash`.
function chain(root: Hex, hash: Hex, opts: { anchored?: boolean; cosigned?: boolean } = {}): ContractReader {
  return {
    async readContract({ functionName, args }) {
      if (functionName === "anchors") return args[0] === 1962n && args[1] === root && opts.anchored !== false ? [3, 1790862482n] : [0, 0n];
      if (functionName === "cosigned") return args[0] === hash && args[1] === COSIGNER && opts.cosigned !== false;
      throw new Error(functionName);
    },
  };
}

async function scenario(signerKid = KEY_ID) {
  const salt = newSalt();
  const messages = [{ role: "user", content: "Say OK" }];
  const params = { temperature: 0, max_tokens: 16 };
  const output = "OK";
  const body = buildReceipt({
    model: "qwen/qwen3.8-27b:free",
    host: { agentId: "erc8004:10143:1962", keyId: KEY_ID, alg: "ES256" },
    req: { commit: commitRequest(salt, messages, params), params, cosigner: COSIGNER },
    res: { commit: commitResponse(salt, output), tokensIn: 9, tokensOut: 1, finish: "stop" },
  });
  const host = await createHostSigner(await privateJwk(), signerKid);
  const jws = await host.signReceipt(body);
  const hash = receiptHash(body);
  const batch = buildBatch([hash, random32(), random32()]);
  const input: VerifyInput = {
    body,
    jws,
    jwks: { keys: [host.publicJwk] },
    proof: batch.proofs.get(hash),
    root: batch.root,
    onchain: { client: chain(batch.root, hash), anchor: ANCHOR },
    salt,
    output,
    messages,
    params,
  };
  return { input, hash, root: batch.root };
}

const failing = (checks: Checks) => Object.entries(checks).filter(([, v]) => v === "fail").map(([k]) => k);

describe("verifyReceipt", () => {
  it("passes every check for a good receipt", async () => {
    const { input, hash } = await scenario();
    const out = await verifyReceipt(input);
    expect(out.ok).toBe(true);
    expect(out.receiptHash).toBe(hash);
    expect(Object.values(out.checks).every((c) => c === "pass")).toBe(true);
  });

  it.each<[string, keyof Checks, (s: Awaited<ReturnType<typeof scenario>>) => Promise<VerifyInput> | VerifyInput]>([
    ["a held body that differs from the signed one", "hash", ({ input }) => ({ ...input, body: { ...input.body, res: { ...input.body.res, tokensOut: 2 } } as ReceiptBody })],
    ["a corrupted JWS signature", "jws", ({ input }) => ({ ...input, jws: input.jws.slice(0, -4) + (input.jws.endsWith("AAAA") ? "BBBB" : "AAAA") })],
    ["a signing kid that doesn't match host.keyId", "kid", async () => (await scenario("some-other-key")).input],
    ["a Merkle proof with one changed element", "merkle", ({ input }) => ({ ...input, proof: [random32(), ...input.proof!.slice(1)] })],
    ["a root that was never anchored", "anchored", ({ input, root, hash }) => ({ ...input, onchain: { anchor: ANCHOR, client: chain(root, hash, { anchored: false }) } })],
    ["an output that differs from the committed one", "outputCommit", ({ input }) => ({ ...input, output: "OK!" })],
    ["a prompt that differs from the committed one", "promptCommit", ({ input }) => ({ ...input, messages: [{ role: "user", content: "Say NO" }] })],
    ["a cosigner that never co-signed onchain", "cosigned", ({ input, root, hash }) => ({ ...input, onchain: { anchor: ANCHOR, client: chain(root, hash, { cosigned: false }) } })],
  ])("%s fails exactly the %s check", async (_, key, corrupt) => {
    const s = await scenario();
    const out = await verifyReceipt(await corrupt(s));
    expect(failing(out.checks)).toEqual([key]);
    expect(out.ok).toBe(false);
  });

  it("skips checks whose inputs are missing and still reports ok", async () => {
    const { input } = await scenario();
    const out = await verifyReceipt({ body: input.body, jws: input.jws, jwks: input.jwks });
    expect(out.ok).toBe(true);
    expect(out.checks).toMatchObject({ jws: "pass", hash: "pass", kid: "pass", merkle: "skipped", anchored: "skipped", outputCommit: "skipped", cosigned: "skipped" });
  });

  it("gives a reproduce entry for every check that ran, and each one recomputes its check", async () => {
    const { input, hash, root } = await scenario();
    const { checks, reproduce } = await verifyReceipt(input);
    expect(Object.keys(reproduce).sort()).toEqual(Object.keys(checks).sort());

    expect(reproduce.jws).toEqual({ kind: "jws", kid: KEY_ID, alg: "ES256", payload: "JCS(body)" });
    expect(reproduce.anchored).toMatchObject({ kind: "contract-call", address: ANCHOR, args: ["1962", root] });
    expect(reproduce.cosigned).toMatchObject({ kind: "contract-call", address: ANCHOR, args: [hash, COSIGNER], expect: "true" });

    // Replay the anchored call from its reproduce entry alone.
    const call = reproduce.anchored!;
    if (call.kind !== "contract-call") throw new Error("expected contract-call");
    const [, anchoredAt] = (await chain(root, hash).readContract({
      address: call.address,
      abi: [],
      functionName: call.function.split("(")[0],
      args: [BigInt(call.args[0]), call.args[1]],
    })) as [number, bigint];
    expect(anchoredAt).not.toBe(0n);

    // Recompute the output commit with node:crypto from the listed inputs only.
    const out = reproduce.outputCommit!;
    if (out.kind !== "compute") throw new Error("expected compute");
    const { salt, output } = out.inputs as { salt: Hex; output: string };
    const digest = createHash("sha256").update(Buffer.from(salt.slice(2), "hex")).update(output, "utf8").digest("hex");
    expect("0x" + digest).toBe(out.expect);
    expect(reproduce.merkle).toMatchObject({ kind: "compute", inputs: { receiptHash: hash, proof: input.proof }, expect: root });
  });

  it("has no reproduce entry for skipped checks", async () => {
    const { input } = await scenario();
    const out = await verifyReceipt({ body: input.body, jws: input.jws, jwks: input.jwks });
    expect(Object.keys(out.reproduce).sort()).toEqual(["hash", "jws", "kid"]);
  });

  it("parses ERC-8004 agent ids", () => {
    expect(parseAgentId("erc8004:10143:1962")).toBe(1962n);
    expect(() => parseAgentId("1962")).toThrow(/agentId/);
  });
});
