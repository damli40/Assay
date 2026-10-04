import { base64url } from "jose";
import type { Hex } from "viem";
import { assertBytes32, commitResponse, newSalt } from "./commit.js";
import { assistantOutput } from "./output.js";
import type { GradeStatus } from "./grade.js";
import { receiptHash, type ReceiptBody } from "./receipt.js";

export interface WrappedResult {
  response: Response;
  json: unknown;
  receipt: { body: ReceiptBody; jws: string; hash: Hex };
  /// Keep it: the salt is what lets you (or a verifier you hand it to) open the commits later.
  salt: Hex;
  /// `res.commit` matches sha256(salt || assistant text) for the bytes this client actually received.
  outputCommitOk: boolean;
}

/// Checked before a request leaves, so a payment path can refuse badly graded hosts automatically.
export interface GradeGate {
  check: () => Promise<GradeStatus>;
  /// Statuses that may proceed. Default: only "pass".
  allow?: readonly GradeStatus[];
  /// Return true to send without checking, e.g. for cheap calls.
  skip?: (init: RequestInit) => boolean;
}

export class GradeGateError extends Error {
  constructor(readonly status: GradeStatus | "error", cause?: unknown) {
    super(status === "error" ? `grade check failed, request not sent: ${(cause as Error)?.message ?? cause}` : `host grade is "${status}", request not sent`);
  }
}

/// A GradeGate check backed by an Assay host's GET /v1/grade.
export function hostGradeCheck(
  gradeUrl: string,
  q: { model: string; host: string; verifiers: readonly string[]; reference?: string },
  fetchImpl: typeof fetch = fetch,
): () => Promise<GradeStatus> {
  const params = new URLSearchParams({ model: q.model, host: q.host, verifiers: q.verifiers.join(",") });
  if (q.reference) params.set("reference", q.reference);
  return async () => {
    const res = await fetchImpl(`${gradeUrl.replace(/\/$/, "")}/v1/grade?${params}`);
    if (!res.ok) throw new Error(`GET /v1/grade returned ${res.status}`);
    return ((await res.json()) as { status: GradeStatus }).status;
  };
}

/// Wraps fetch for an Assay host: sends a fresh salt (and the co-signer key hash, D19), returns the parsed receipt.
/// With `gate`, the host's grade is checked first and the request is refused unless it is allowed.
export function wrap(fetchImpl: typeof fetch, opts: { cosigner?: Hex; gate?: GradeGate } = {}) {
  if (opts.cosigner !== undefined) assertBytes32(opts.cosigner, "cosigner");
  return async (input: RequestInfo | URL, init: RequestInit = {}): Promise<WrappedResult> => {
    const gate = opts.gate;
    if (gate && !gate.skip?.(init)) {
      // Fails closed: if the grade can't be read, nothing is sent and nothing is paid.
      const status = await gate.check().catch((e: unknown) => {
        throw new GradeGateError("error", e);
      });
      if (!(gate.allow ?? ["pass"]).includes(status)) throw new GradeGateError(status);
    }
    const salt = newSalt();
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set("X-Assay-Salt", salt.slice(2));
    if (opts.cosigner) headers.set("X-Assay-Cosigner", opts.cosigner);

    const response = await fetchImpl(input, { ...init, headers });
    const header = response.headers.get("X-Assay-Receipt");
    if (!header) throw new Error(`no X-Assay-Receipt header in the response (HTTP ${response.status}); is this an Assay host?`);
    const { body, jws } = JSON.parse(new TextDecoder().decode(base64url.decode(header))) as { body: ReceiptBody; jws: string };
    const hash = receiptHash(body);
    const claimed = response.headers.get("X-Assay-Receipt-Hash");
    if (claimed !== null && claimed.toLowerCase() !== hash) throw new Error(`X-Assay-Receipt-Hash ${claimed} != sha256(JCS(body)) ${hash}`);

    const json = (await response.json()) as { choices?: { message?: unknown }[] };
    const text = assistantOutput(json.choices?.[0]?.message);
    const outputCommitOk = text !== undefined && commitResponse(salt, text) === body.res.commit;
    return { response, json, receipt: { body, jws, hash }, salt, outputCommitOk };
  };
}
