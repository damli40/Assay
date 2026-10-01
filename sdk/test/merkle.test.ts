import { readFileSync } from "node:fs";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { toHex, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { buildBatch, leafHash, verifyProof } from "../src/merkle.js";

const random32 = () => toHex(crypto.getRandomValues(new Uint8Array(32)));
const fixture = JSON.parse(readFileSync(new URL("../../contracts/test/fixtures/webcrypto.json", import.meta.url), "utf8"));

describe("merkle", () => {
  it("leafHash matches ReceiptAnchor.leafOf (Solidity vector)", () => {
    expect(leafHash(toHex(1, { size: 32 }))).toBe("0xb5d9d894133a730aa651ef62d26b0ffa846233c74177a591a4a896adfda97d22");
  });

  it("leafHash matches StandardMerkleTree and every leaf in the Solidity fixture", () => {
    fixture.merkle.receipts.forEach((h: Hex, i: number) => {
      expect(leafHash(h)).toBe(fixture.merkle.leaves[i]);
      expect(leafHash(h)).toBe(StandardMerkleTree.of([[h]], ["bytes32"]).leafHash([h]));
    });
  });

  it("reproduces the fixture's root, so proofs match what Fixtures.t.sol verifies", () => {
    expect(buildBatch(fixture.merkle.receipts).root).toBe(fixture.merkle.root);
  });

  it("every proof verifies, and a single flipped bit breaks it", () => {
    const hashes = Array.from({ length: 13 }, random32);
    const { root, proofs } = buildBatch(hashes);
    for (const h of hashes) {
      const proof = proofs.get(h)!;
      expect(verifyProof(h, proof, root)).toBe(true);
      const bad = [...proof];
      bad[0] = (bad[0].slice(0, -1) + (bad[0].endsWith("0") ? "1" : "0")) as Hex;
      expect(verifyProof(h, bad, root)).toBe(false);
      expect(verifyProof(random32(), proof, root)).toBe(false);
    }
  });

  it("a one-receipt batch has the leaf as root and an empty proof", () => {
    const h = random32();
    const { root, proofs } = buildBatch([h]);
    expect(root).toBe(leafHash(h));
    expect(proofs.get(h)).toEqual([]);
  });

  it("normalizes hex case so proofs are found either way", () => {
    const h = random32();
    const { proofs } = buildBatch([h.toUpperCase().replace("0X", "0x") as Hex, random32()]);
    expect(proofs.has(h)).toBe(true);
  });

  it("rejects empty batches, duplicates and malformed hashes", () => {
    const h = random32();
    expect(() => buildBatch([])).toThrow(/empty/);
    expect(() => buildBatch([h, h])).toThrow(/duplicate/);
    expect(() => buildBatch(["0x1234"])).toThrow(/32 bytes/);
  });
});
