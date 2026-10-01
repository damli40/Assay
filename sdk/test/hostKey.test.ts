import { describe, expect, it } from "vitest";
import { hostKeyForAgent, hostKeyForEndpoint } from "../src/hostKey.js";

// Expected values come from `cast keccak "<string>"`.
describe("host keys (D21)", () => {
  it("hashes the ERC-8004 identity string", () => {
    expect(hostKeyForAgent(10143n, 1962n)).toBe("0xbc6bc5b79f83de1bb4e63bacbdb8d82c8a38e1c9caa38043f8b6ba33ffb33e6c");
    expect(hostKeyForAgent(31337, 1)).toBe("0x953e377eb45180111dd33cc3efda7fb7589dee86860917248d690c1472d5ba1e");
  });

  it("hashes the endpoint tag with the openrouter: prefix", () => {
    expect(hostKeyForEndpoint("qwen/qwen3.8-27b:free@chutes")).toBe(
      "0xf684de88c6aa5f740fbbca95bd9c39eff5d015695548bdd967a92ac38d80d1db",
    );
  });

  it("rejects non-integer ids", () => {
    expect(() => hostKeyForAgent(1.5, 1)).toThrow();
  });
});
