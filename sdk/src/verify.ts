import type { JWK } from "jose";
import type { Address, Hex } from "viem";
import { commitRequest, commitResponse } from "./commit.js";
import { verifyReceiptJws } from "./hostSigner.js";
import { verifyProof } from "./merkle.js";
import { receiptHash, type ReceiptBody } from "./receipt.js";

export type Check = "pass" | "fail" | "skipped";

export interface Checks {
  /// The host's JWS signature verifies against its published JWKS.
  jws: Check;
  /// The body you hold is exactly the body the host signed.
  hash: Check;
  /// The signing key id matches `host.keyId` in the body.
  kid: Check;
  /// The Merkle proof puts the receipt under `root`.
  merkle: Check;
  /// `root` was anchored onchain by the host named in the body.
  anchored: Check;
  /// `salt` + `output` reproduce `res.commit`.
  outputCommit: Check;
  /// `salt` + `messages` + `params` reproduce `req.commit`.
  promptCommit: Check;
  /// The key named in `req.cosigner` co-signed this receipt onchain (D19).
  cosigned: Check;
}

/// Anything with viem's `readContract`, e.g. a PublicClient.
export interface ContractReader {
  readContract(args: { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] }): Promise<unknown>;
}

export interface VerifyInput {
  body: ReceiptBody;
  jws: string;
  jwks: { keys: JWK[] };
  proof?: Hex[];
  root?: Hex;
  onchain?: { client: ContractReader; anchor: Address };
  salt?: Hex;
  output?: string;
  messages?: unknown;
  params?: unknown;
}

export interface VerifyResult {
  ok: boolean;
  receiptHash: Hex;
  checks: Checks;
}

export const receiptAnchorAbi = [
  {
    type: "function",
    name: "anchors",
    stateMutability: "view",
    inputs: [{ type: "uint256" }, { type: "bytes32" }],
    outputs: [{ type: "uint32" }, { type: "uint64" }],
  },
  {
    type: "function",
    name: "cosigned",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }, { type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
] as const;

/// "erc8004:<chainId>:<agentId>" → agentId.
export function parseAgentId(agentId: string): bigint {
  const m = /^erc8004:\d+:(\d+)$/.exec(agentId);
  if (!m) throw new Error(`bad host.agentId: ${agentId}`);
  return BigInt(m[1]);
}

const check = (cond: boolean): Check => (cond ? "pass" : "fail");

/// Runs every check it has inputs for and reports each one on its own, so a failure says exactly what is wrong.
export async function verifyReceipt(input: VerifyInput): Promise<VerifyResult> {
  const held = receiptHash(input.body);
  const checks: Checks = {
    jws: "fail",
    hash: "skipped",
    kid: "skipped",
    merkle: "skipped",
    anchored: "skipped",
    outputCommit: "skipped",
    promptCommit: "skipped",
    cosigned: "skipped",
  };

  // Later checks use the hash of the body the host signed, so one corrupted input fails exactly one check.
  let signed: ReceiptBody | undefined;
  try {
    const out = await verifyReceiptJws(input.jws, input.jwks);
    signed = out.body;
    checks.jws = "pass";
    checks.hash = check(receiptHash(out.body) === held);
    checks.kid = check(out.kid === out.body.host.keyId);
  } catch {
    // jws stays "fail"; hash and kid can't be judged without a valid signature.
  }
  const body = signed ?? input.body;
  const hash = signed ? receiptHash(signed) : held;

  if (input.proof && input.root) checks.merkle = check(verifyProof(hash, input.proof, input.root));

  if (input.onchain && input.root) {
    const [, anchoredAt] = (await input.onchain.client.readContract({
      address: input.onchain.anchor,
      abi: receiptAnchorAbi,
      functionName: "anchors",
      args: [parseAgentId(body.host.agentId), input.root],
    })) as [number, bigint];
    checks.anchored = check(anchoredAt !== 0n);
  }

  if (input.onchain && body.req.cosigner) {
    const ok = (await input.onchain.client.readContract({
      address: input.onchain.anchor,
      abi: receiptAnchorAbi,
      functionName: "cosigned",
      args: [hash, body.req.cosigner],
    })) as boolean;
    checks.cosigned = check(ok);
  }

  if (input.salt !== undefined && input.output !== undefined) {
    checks.outputCommit = check(commitResponse(input.salt, input.output) === body.res.commit);
  }
  if (input.salt !== undefined && input.messages !== undefined) {
    checks.promptCommit = check(commitRequest(input.salt, input.messages, input.params ?? body.req.params) === body.req.commit);
  }

  const ok = Object.values(checks).every((c) => c !== "fail");
  return { ok, receiptHash: hash, checks };
}
