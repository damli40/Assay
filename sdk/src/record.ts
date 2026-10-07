import { base64url } from "jose";
import { createPublicClient, http, isHex, sha256, stringToBytes, type Address, type Hex } from "viem";
import type { ReceiptBody } from "./receipt.js";
import { verifyReceipt, type Checks, type ContractReader } from "./verify.js";

/// Assay's interop shape (docs/interop/) plus the opening only the asker holds.
export interface ContextRecord {
  receiptHash: Hex;
  chainId: number;
  jws: string;
  jwks: { keys: unknown[] };
  anchor: { agentId: number; root: Hex; proof: Hex[] };
  salt: Hex;
  output: string;
  messages: unknown;
}

export interface Verdict {
  ok: boolean;
  reasons: string[];
  checks?: Checks;
  body?: ReceiptBody;
}

/// Checks that must pass. `anchored` joins them unless the caller runs offline; `cosigned` is never required.
const REQUIRED: (keyof Checks)[] = ["jws", "hash", "kid", "merkle", "outputCommit", "promptCommit"];

/// The reader's own pins: which hosts it accepts, and per chain the ReceiptAnchor and RPC to read.
/// Never take these from the record: a record could name any contract or RPC.
export interface RecordPins {
  trustedHosts: string[];
  chains: Record<number, { anchor: Address; rpc: string }>;
  /// Skip the chain read (CI). Every other check still runs.
  offline?: boolean;
  /// Injected reader for tests; otherwise a client on the pinned RPC.
  client?: ContractReader;
}

/// Checks the Assay receipt carried with a piece of context (e.g. a Mida record) before an agent uses it.
/// Fails closed: the receipt must come from a pinned host, be signed and in its batch, be anchored (unless
/// offline), and the salt must open both commits, so the context is exactly that output to that prompt.
export async function checkRecord(record: ContextRecord, pins: RecordPins): Promise<Verdict> {
  const trusted = pins.trustedHosts;
  const fail = (...reasons: string[]): Verdict => ({ ok: false, reasons });
  const r = record as Partial<ContextRecord> | null;
  if (!r || typeof r.jws !== "string" || !r.anchor || !Array.isArray(r.anchor.proof) || !isHex(r.salt) || typeof r.output !== "string" || r.messages === undefined) {
    return fail("the record needs jws, jwks, anchor {agentId, root, proof}, salt, output and messages");
  }
  const chain = pins.chains[r.chainId as number];
  if (!chain) return fail(`chain ${r.chainId} isn't one this agent reads`);

  // The body comes from the signed bytes, never from a separate field the record could disagree with.
  let payload: string;
  let body: ReceiptBody;
  try {
    payload = new TextDecoder().decode(base64url.decode(r.jws.split(".")[1] ?? ""));
    body = JSON.parse(payload);
  } catch {
    return fail("the JWS payload isn't base64url JSON");
  }
  if (sha256(stringToBytes(payload)) !== r.receiptHash?.toLowerCase()) return fail("receiptHash isn't sha256 of the signed payload");
  if (!trusted.includes(body.host?.agentId)) return fail(`host ${body.host?.agentId} isn't a trusted host`);
  if (body.host.agentId !== `erc8004:${r.chainId}:${r.anchor.agentId}`) return fail("the record's chainId and agentId don't match the host the receipt names");

  const client = pins.offline ? undefined : (pins.client ?? (createPublicClient({ transport: http(chain.rpc) }) as unknown as ContractReader));
  const result = await verifyReceipt({
    body,
    jws: r.jws,
    jwks: r.jwks as never,
    proof: r.anchor.proof,
    root: r.anchor.root,
    salt: r.salt,
    output: r.output,
    messages: r.messages,
    ...(client ? { onchain: { client, anchor: chain.anchor } } : {}),
  });
  const required = client ? [...REQUIRED, "anchored" as const] : REQUIRED;
  const reasons = required.filter((k) => result.checks[k] !== "pass").map((k) => `${k}: ${result.checks[k]}`);
  return { ok: reasons.length === 0, reasons, checks: result.checks, body };
}
