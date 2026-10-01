import { sha256, stringToBytes, toHex, type Hex } from "viem";
import { assertBytes32 } from "./commit.js";
import { jcs } from "./jcs.js";

export const RECEIPT_VERSION = "assay-receipt/0";

export interface ReceiptBody {
  v: typeof RECEIPT_VERSION;
  model: string;
  host: { agentId: string; keyId: string; alg: "ES256" | "ES256K" };
  req: { commit: Hex; params: Record<string, unknown>; cosigner?: Hex };
  res: { commit: Hex; tokensIn: number; tokensOut: number; finish: string };
  price?: { asset: string; amount: string };
  t: number;
  nonce: Hex;
}

export interface ReceiptInput {
  model: string;
  host: ReceiptBody["host"];
  req: ReceiptBody["req"];
  res: ReceiptBody["res"];
  price?: ReceiptBody["price"];
  t?: number;
  nonce?: Hex;
}

/// Builds a SPEC section 1 body. Optional fields that are absent are left out, never set to undefined.
export function buildReceipt(input: ReceiptInput): ReceiptBody {
  assertBytes32(input.req.commit, "req.commit");
  assertBytes32(input.res.commit, "res.commit");
  if (input.req.cosigner !== undefined) assertBytes32(input.req.cosigner, "req.cosigner");
  // Integers only: floats canonicalize differently across languages.
  for (const [name, n] of [
    ["res.tokensIn", input.res.tokensIn],
    ["res.tokensOut", input.res.tokensOut],
  ] as const) {
    if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
  }

  const t = input.t ?? Date.now();
  if (!Number.isSafeInteger(t) || t <= 0) throw new Error("t must be a positive integer (ms)");
  const nonce = input.nonce ?? toHex(crypto.getRandomValues(new Uint8Array(16)));

  const req: ReceiptBody["req"] = { commit: input.req.commit, params: input.req.params };
  if (input.req.cosigner !== undefined) req.cosigner = input.req.cosigner;

  const body: ReceiptBody = { v: RECEIPT_VERSION, model: input.model, host: input.host, req, res: input.res, t, nonce };
  if (input.price !== undefined) body.price = input.price;
  return body;
}

/// sha256(JCS(body)): the value every signature and Merkle tree refers to.
export function receiptHash(body: ReceiptBody): Hex {
  return sha256(stringToBytes(jcs(body)));
}
