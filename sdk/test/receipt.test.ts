import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildReceipt, receiptHash, type ReceiptBody, type ReceiptInput } from "../src/receipt.js";
import { jcs } from "../src/jcs.js";

const b32 = (byte: string) => ("0x" + byte.repeat(32)) as `0x${string}`;

const input: ReceiptInput = {
  model: "z-ai/glm-5.3",
  host: { agentId: "erc8004:10143:1962", keyId: "host-key-2026-10", alg: "ES256" },
  req: { commit: b32("aa"), params: { temperature: 0, max_tokens: 512 } },
  res: { commit: b32("bb"), tokensIn: 812, tokensOut: 143, finish: "stop" },
  price: { asset: "USDC", amount: "0.00041" },
  t: 1790500000000,
  nonce: ("0x" + "cc".repeat(16)) as `0x${string}`,
};

// Every leaf path in the body, so the test can mutate each one.
function leafPaths(value: unknown, path: string[] = []): string[][] {
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => leafPaths(v, [...path, k]));
  }
  return [path];
}

function mutate(body: ReceiptBody, path: string[]): ReceiptBody {
  const copy = structuredClone(body) as any;
  let node = copy;
  for (const k of path.slice(0, -1)) node = node[k];
  const last = path[path.length - 1];
  const v = node[last];
  node[last] = typeof v === "number" ? v + 1 : typeof v === "string" ? v.replace(/.$/, (c) => (c === "0" ? "1" : "0")) : !v;
  return copy;
}

describe("receipt", () => {
  it("builds the SPEC section 1 shape", () => {
    const body = buildReceipt(input);
    expect(body.v).toBe("assay-receipt/0");
    expect(Object.keys(body).sort()).toEqual(["host", "model", "nonce", "price", "req", "res", "t", "v"]);
    expect("cosigner" in body.req).toBe(false);
  });

  it("receiptHash = sha256(JCS(body)), checked with node:crypto", () => {
    const body = buildReceipt(input);
    expect(receiptHash(body)).toBe("0x" + createHash("sha256").update(jcs(body), "utf8").digest("hex"));
  });

  it("changing any single field changes the hash", () => {
    const body = buildReceipt({ ...input, req: { ...input.req, cosigner: b32("dd") } });
    const original = receiptHash(body);
    const paths = leafPaths(body);
    expect(paths.length).toBeGreaterThan(12);
    for (const p of paths) expect(receiptHash(mutate(body, p)), p.join(".")).not.toBe(original);
  });

  it("fills t and a 16-byte nonce when absent", () => {
    const { t, nonce, ...rest } = input;
    const body = buildReceipt(rest);
    expect(Number.isSafeInteger(body.t)).toBe(true);
    expect(body.nonce).toMatch(/^0x[0-9a-f]{32}$/);
    expect(buildReceipt(rest).nonce).not.toBe(body.nonce);
  });

  it("includes req.cosigner only when given (D19)", () => {
    expect(buildReceipt({ ...input, req: { ...input.req, cosigner: b32("dd") } }).req.cosigner).toBe(b32("dd"));
    expect(() => buildReceipt({ ...input, req: { ...input.req, cosigner: "0x1234" } })).toThrow(/cosigner/);
  });

  it("omits price when absent instead of writing undefined", () => {
    const { price, ...rest } = input;
    expect("price" in buildReceipt(rest)).toBe(false);
  });

  it.each([
    ["fractional tokensIn", { res: { ...input.res, tokensIn: 1.5 } }, /tokensIn/],
    ["negative tokensOut", { res: { ...input.res, tokensOut: -1 } }, /tokensOut/],
    ["fractional t", { t: 1.5 }, /\bt\b/],
    ["short req.commit", { req: { ...input.req, commit: "0x12" } }, /req.commit/],
    ["short res.commit", { res: { ...input.res, commit: "0x12" } }, /res.commit/],
  ])("rejects %s", (_, patch, err) => {
    expect(() => buildReceipt({ ...input, ...(patch as Partial<ReceiptInput>) })).toThrow(err);
  });
});
