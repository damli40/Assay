import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { commitRequest, commitResponse, newSalt } from "../src/commit.js";
import { jcs } from "../src/jcs.js";

const nodeSha256 = (...parts: Buffer[]) => "0x" + createHash("sha256").update(Buffer.concat(parts)).digest("hex");
const salt = ("0x" + "11".repeat(32)) as `0x${string}`;
const messages = [{ role: "user", content: "Say OK" }];
const params = { temperature: 0, max_tokens: 16 };

describe("commit", () => {
  it("newSalt is 32 random bytes", () => {
    const a = newSalt();
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(newSalt()).not.toBe(a);
  });

  it("commitRequest = sha256(salt || JCS({messages, params})), checked with node:crypto", () => {
    const expected = nodeSha256(Buffer.from(salt.slice(2), "hex"), Buffer.from(jcs({ messages, params }), "utf8"));
    expect(commitRequest(salt, messages, params)).toBe(expected);
  });

  it("commitResponse = sha256(salt || utf8(output)), including non-ASCII text", () => {
    const output = "OK, 好的 ✓";
    expect(commitResponse(salt, output)).toBe(nodeSha256(Buffer.from(salt.slice(2), "hex"), Buffer.from(output, "utf8")));
  });

  it("a different salt gives a different commit", () => {
    expect(commitResponse(newSalt(), "yes")).not.toBe(commitResponse(newSalt(), "yes"));
  });

  it("param key order doesn't change the request commit", () => {
    expect(commitRequest(salt, messages, { max_tokens: 16, temperature: 0 })).toBe(commitRequest(salt, messages, params));
  });

  it.each(["0x1234", "0x" + "11".repeat(33), "11".repeat(32), "0x" + "zz".repeat(32)])("rejects salt %s", (bad) => {
    expect(() => commitResponse(bad as `0x${string}`, "x")).toThrow(/salt/);
    expect(() => commitRequest(bad as `0x${string}`, messages, params)).toThrow(/salt/);
  });
});
