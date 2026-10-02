import { base64url } from "jose";
import type { Hex } from "viem";
import { assertBytes32, commitResponse, newSalt } from "./commit.js";
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

/// Wraps fetch for an Assay host: sends a fresh salt (and the co-signer key hash, D19), returns the parsed receipt.
export function wrap(fetchImpl: typeof fetch, opts: { cosigner?: Hex } = {}) {
  if (opts.cosigner !== undefined) assertBytes32(opts.cosigner, "cosigner");
  return async (input: RequestInfo | URL, init: RequestInit = {}): Promise<WrappedResult> => {
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

    const json = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
    const text = json.choices?.[0]?.message?.content;
    const outputCommitOk = typeof text === "string" && commitResponse(salt, text) === body.res.commit;
    return { response, json, receipt: { body, jws, hash }, salt, outputCommitOk };
  };
}
