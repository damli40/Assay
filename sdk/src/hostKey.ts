import { keccak256, stringToBytes, type Hex } from "viem";

/// D21: grades for an Assay host follow its ERC-8004 identity, so rotating the signing key can't shed a bad grade.
export function hostKeyForAgent(chainId: bigint | number, agentId: bigint | number): Hex {
  return keccak256(stringToBytes(`erc8004:${BigInt(chainId)}:${BigInt(agentId)}`));
}

/// Unkeyed endpoints (e.g. an OpenRouter provider). Same bytes as Solidity keccak256(abi.encodePacked("openrouter:", tag)).
export function hostKeyForEndpoint(tag: string): Hex {
  return keccak256(stringToBytes(`openrouter:${tag}`));
}

/// A lab's own API graded directly (harness `--base-url`), tagged `direct:<host>`. Same convention as harness/export_grade.py.
export function hostKeyForDirect(host: string): Hex {
  return keccak256(stringToBytes(`direct:${host}`));
}
