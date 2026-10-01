import { describe, expect, it } from "vitest";
import { parseReceipt, parseSalt, toBase64url } from "../src/lib/receipt.js";

const held = {
  body: { v: "assay-receipt/0", model: "m", host: { agentId: "erc8004:10143:1962", keyId: "k", alg: "ES256" } },
  jws: "aaa.bbb.ccc",
};

describe("parseReceipt", () => {
  it("reads the X-Assay-Receipt header form", () => {
    expect(parseReceipt(toBase64url(JSON.stringify(held)))).toEqual(held);
  });

  it("reads non-ASCII bodies through base64url", () => {
    const r = { ...held, body: { ...held.body, model: "模型/é" } };
    expect(parseReceipt(toBase64url(JSON.stringify(r))).body.model).toBe("模型/é");
  });

  it("reads JSON, including a GET /v1/receipts/:hash response with extra fields", () => {
    expect(parseReceipt(`  ${JSON.stringify({ status: "anchored", ...held, root: "0x" })}\n`)).toEqual(held);
  });

  it.each([
    ["", /Paste a receipt/],
    ["not base64!", /neither JSON nor base64url/],
    [toBase64url("hello"), /valid JSON/],
    ["{bad json", /valid JSON/],
    [JSON.stringify({ body: held.body }), /`jws` string/],
    [JSON.stringify({ ...held, body: { ...held.body, v: "x" } }), /Unknown receipt version/],
    [JSON.stringify({ ...held, jws: "a.b" }), /compact JWS/],
  ])("rejects %j", (input, msg) => {
    expect(() => parseReceipt(input)).toThrow(msg);
  });
});

describe("parseSalt", () => {
  const hex = "ab".repeat(32);
  it("accepts with or without 0x and lowercases", () => {
    expect(parseSalt(hex.toUpperCase())).toBe(`0x${hex}`);
    expect(parseSalt(`0x${hex}`)).toBe(`0x${hex}`);
  });
  it("rejects wrong length and non-hex", () => {
    expect(() => parseSalt("ab")).toThrow(/64 hex/);
    expect(() => parseSalt("zz".repeat(32))).toThrow(/64 hex/);
  });
});
