// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { chainOfAgentId, selectedChainId, setSelectedChainId } from "../src/lib/config.js";
import { gradesChain } from "../src/views/grades.js";

describe("network switch", () => {
  it("falls back to the default for unknown or missing values, and remembers known ones", () => {
    localStorage.removeItem("assay.chain");
    expect(selectedChainId()).toBe(143);
    localStorage.setItem("assay.chain", "999");
    expect(selectedChainId()).toBe(143);
    setSelectedChainId(10143);
    expect(selectedChainId()).toBe(10143);
  });

  it("reads the chain from a receipt's agent id", () => {
    expect(chainOfAgentId("erc8004:143:7")).toBe(143);
    expect(chainOfAgentId("openrouter:x")).toBeUndefined();
  });

  it("Grades reads the chain from ?chain=, then from an erc8004 host", () => {
    expect(gradesChain(new URLSearchParams("chain=10143"))).toBe(10143);
    expect(gradesChain(new URLSearchParams("host=erc8004:143:10278"))).toBe(143);
    expect(gradesChain(new URLSearchParams("host=erc8004:10143:1962"))).toBe(10143);
  });
});
