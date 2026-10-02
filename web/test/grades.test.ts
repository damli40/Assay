import { hostKeyForAgent, hostKeyForDirect, hostKeyForEndpoint } from "@assay/receipts";
import { keccak256, stringToBytes } from "viem";
import { describe, expect, it } from "vitest";
import { hostKeyFromInput, modelKey, parseAddresses } from "../src/lib/grades.js";

describe("hostKeyFromInput", () => {
  it("a bare number is an agent id on Monad testnet", () => {
    expect(hostKeyFromInput("1962")).toEqual({ kind: "agent", hostKey: hostKeyForAgent(10143, 1962), preimage: "erc8004:10143:1962" });
  });

  it("a full erc8004 id keeps its own chain", () => {
    expect(hostKeyFromInput("erc8004:1:7").hostKey).toBe(hostKeyForAgent(1, 7));
  });

  it("anything else is an OpenRouter provider tag", () => {
    expect(hostKeyFromInput(" deepinfra/fp8 ")).toEqual({ kind: "endpoint", hostKey: hostKeyForEndpoint("deepinfra/fp8"), preimage: "openrouter:deepinfra/fp8" });
  });

  it("direct:<host> is a lab's own API, matching the posted reference grade", () => {
    const g = hostKeyFromInput("direct:generativelanguage.googleapis.com");
    expect(g).toEqual({ kind: "endpoint", hostKey: hostKeyForDirect("generativelanguage.googleapis.com"), preimage: "direct:generativelanguage.googleapis.com" });
    expect(g.hostKey).toBe("0xd0fe1e8708e22bc3fe3b101f9ab21a41052eb11b27d4d994f91cccca881927c7");
  });

  it("a pasted openrouter: prefix is not doubled", () => {
    expect(hostKeyFromInput("openrouter:google-ai-studio").hostKey).toBe("0x38e3ba25890a8d31a96ec36823ede8271d3df40b6d7ce2d94f4419b18344bcc9");
    expect(hostKeyFromInput("google-ai-studio").preimage).toBe("openrouter:google-ai-studio");
  });

  it("agent and endpoint keys never coincide for the same text", () => {
    expect(hostKeyFromInput("1962").hostKey).not.toBe(hostKeyForEndpoint("1962"));
  });

  it("rejects empty input and tags with spaces", () => {
    expect(() => hostKeyFromInput("  ")).toThrow(/agent id/);
    expect(() => hostKeyFromInput("a b")).toThrow(/no spaces/);
  });
});

describe("modelKey / parseAddresses", () => {
  it("model is keccak256 of the trimmed name", () => {
    expect(modelKey(" z-ai/glm-5.3 ")).toBe(keccak256(stringToBytes("z-ai/glm-5.3")));
  });

  it("splits on commas and whitespace and rejects bad addresses", () => {
    const a = "0x0C8603041E7d425c4DCa041680C7AF4581dDa9a1";
    const b = "0x049A73755cA3508ef3Daa4752A3406f6e00CfB13";
    expect(parseAddresses(`${a},\n ${b}`)).toEqual([a, b]);
    expect(parseAddresses("")).toEqual([]);
    expect(() => parseAddresses("0x123")).toThrow(/Not an address/);
  });
});
