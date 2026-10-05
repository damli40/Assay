// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { chainOfAgentId, selectedChainId, setSelectedChainId } from "../src/lib/config.js";

describe("network switch", () => {
  it("falls back to the default for unknown or missing values, and remembers known ones", () => {
    localStorage.removeItem("assay.chain");
    expect(selectedChainId()).toBe(10143);
    localStorage.setItem("assay.chain", "999");
    expect(selectedChainId()).toBe(10143);
    setSelectedChainId(10143);
    expect(selectedChainId()).toBe(10143);
  });

  it("reads the chain from a receipt's agent id", () => {
    expect(chainOfAgentId("erc8004:143:7")).toBe(143);
    expect(chainOfAgentId("openrouter:x")).toBeUndefined();
  });
});
