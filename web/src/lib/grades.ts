import { hostKeyForAgent, hostKeyForDirect, hostKeyForEndpoint } from "@assay/receipts";
import { isAddress, keccak256, stringToBytes, type Address, type Hex } from "viem";
import { CHAIN_ID } from "./config.js";

export interface HostKeyChoice {
  kind: "agent" | "endpoint";
  hostKey: Hex;
  /// The exact preimage, shown so a reader can recompute the key.
  preimage: string;
}

/// An agent id ("1962" or "erc8004:<chainId>:<agentId>") names an Assay host (D21), "direct:<host>" a lab's own API;
/// anything else is an OpenRouter provider tag, with or without its "openrouter:" prefix.
export function hostKeyFromInput(input: string, chainId: number = CHAIN_ID): HostKeyChoice {
  const s = input.trim();
  if (!s) throw new Error("Enter an agent id or an OpenRouter provider tag.");
  const full = /^erc8004:(\d+):(\d+)$/.exec(s);
  if (full) return { kind: "agent", hostKey: hostKeyForAgent(BigInt(full[1]), BigInt(full[2])), preimage: s };
  if (/^\d+$/.test(s)) return { kind: "agent", hostKey: hostKeyForAgent(chainId, BigInt(s)), preimage: `erc8004:${chainId}:${s}` };
  if (/\s/.test(s)) throw new Error("A provider tag has no spaces.");
  const direct = /^direct:(.+)$/.exec(s);
  if (direct) return { kind: "endpoint", hostKey: hostKeyForDirect(direct[1]), preimage: s };
  const tag = s.replace(/^openrouter:/, "");
  return { kind: "endpoint", hostKey: hostKeyForEndpoint(tag), preimage: `openrouter:${tag}` };
}

/// SPEC section 5: model = keccak256("z-ai/glm-5.3").
export const modelKey = (model: string): Hex => keccak256(stringToBytes(model.trim()));

export function parseAddresses(text: string): Address[] {
  const list = text.split(/[\s,]+/).filter(Boolean);
  for (const a of list) if (!isAddress(a)) throw new Error(`Not an address: ${a}`);
  return list as Address[];
}
