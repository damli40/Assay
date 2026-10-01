import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { encodeAbiParameters, keccak256, type Hex } from "viem";
import { assertBytes32 } from "./commit.js";

/// Same leaf as ReceiptAnchor.leafOf: keccak256(bytes.concat(keccak256(abi.encode(receiptHash)))).
export function leafHash(receiptHash: Hex): Hex {
  return keccak256(keccak256(encodeAbiParameters([{ type: "bytes32" }], [receiptHash])));
}

export interface Batch {
  root: Hex;
  proofs: Map<Hex, Hex[]>;
}

/// One anchored batch. Rejects empty batches (the contract does too) and duplicate hashes.
export function buildBatch(receiptHashes: Hex[]): Batch {
  if (receiptHashes.length === 0) throw new Error("empty batch");
  const hashes = receiptHashes.map((h) => h.toLowerCase() as Hex);
  hashes.forEach((h) => assertBytes32(h, "receiptHash"));
  if (new Set(hashes).size !== hashes.length) throw new Error("duplicate receipt hash in batch");

  const tree = StandardMerkleTree.of(
    hashes.map((h) => [h]),
    ["bytes32"],
  );
  const proofs = new Map<Hex, Hex[]>();
  for (const [i, [h]] of tree.entries()) proofs.set(h as Hex, tree.getProof(i) as Hex[]);
  return { root: tree.root as Hex, proofs };
}

export function verifyProof(receiptHash: Hex, proof: Hex[], root: Hex): boolean {
  return StandardMerkleTree.verify(root, ["bytes32"], [receiptHash.toLowerCase()], proof);
}
