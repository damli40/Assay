import { concat, hexToBytes, isHex, sha256, size, stringToBytes, toHex, type Hex } from "viem";
import { jcs } from "./jcs.js";

export function newSalt(): Hex {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

export function assertBytes32(value: Hex, name: string): void {
  if (!isHex(value, { strict: true }) || size(value) !== 32) throw new Error(`${name} must be 32 bytes of hex`);
}

/// sha256(salt || JCS({messages, params})), SPEC section 1.
export function commitRequest(salt: Hex, messages: unknown, params: unknown): Hex {
  assertBytes32(salt, "salt");
  return sha256(concat([hexToBytes(salt), stringToBytes(jcs({ messages, params }))]));
}

/// sha256(salt || utf8(outputText)), SPEC section 1.
export function commitResponse(salt: Hex, outputText: string): Hex {
  assertBytes32(salt, "salt");
  return sha256(concat([hexToBytes(salt), stringToBytes(outputText)]));
}
