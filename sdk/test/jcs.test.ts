import { describe, expect, it } from "vitest";
import { jcs } from "../src/jcs.js";

describe("jcs", () => {
  it("matches the RFC 8785 vector verified on 29 Sep", () => {
    expect(jcs({ b: 2, a: [1, "x", { d: 1e21, c: 0.00041 }] })).toBe('{"a":[1,"x",{"c":0.00041,"d":1e+21}],"b":2}');
  });

  it("is independent of key order", () => {
    expect(jcs({ a: 1, b: { y: 2, x: 1 } })).toBe(jcs({ b: { x: 1, y: 2 }, a: 1 }));
  });

  it.each([
    ["NaN", { a: NaN }],
    ["Infinity", { a: Infinity }],
    ["undefined in an object", { a: undefined, b: 1 }],
    ["undefined in an array", [1, undefined]],
    ["nested undefined", { a: { b: [undefined] } }],
    ["BigInt", { a: 1n }],
  ])("throws on %s", (_, value) => {
    expect(() => jcs(value)).toThrow();
  });
});
