import type { ReceiptBody, VerifyInput, WebAuthnAuth } from "@assay/receipts";
import type { Hex } from "viem";

export const hostUrl = (base: string, path: string) => `${base.trim().replace(/\/+$/, "")}${path}`;

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw Object.assign(new Error(`${url}: HTTP ${res.status}${json.error?.message ? `, ${json.error.message}` : ""}`), { status: res.status });
  return json;
}

/// `pending` is how many receipts wait for the host's next batch. Hosts with the batch clock also report
/// `batchSeconds` and `nextBatchInMs` (relative, so the reader's clock skew doesn't matter).
export interface Health {
  ok: boolean;
  pending: number;
  batchSeconds?: number;
  nextBatchInMs?: number | null;
}
export const fetchHealth = (base: string) => getJson<Health>(hostUrl(base, "/health"));

export const fetchJwks = (base: string) => getJson<VerifyInput["jwks"]>(hostUrl(base, "/.well-known/jwks.json"));

export type ReceiptStatus =
  | { status: "pending" }
  | { status: "anchored"; body: ReceiptBody; jws: string; root: Hex; proof: Hex[]; anchorTx?: Hex; reproduce?: { cast?: string } };

/// The HTTP status of a failed host call, or undefined when the host never answered.
export const httpStatus = (e: unknown): number | undefined => (e as { status?: number } | null)?.status;

export const fetchReceiptStatus = (base: string, hash: Hex) => getJson<ReceiptStatus>(hostUrl(base, `/v1/receipts/${hash}`));

export interface BatchReceipts {
  root: Hex;
  count: number;
  receipts: Hex[];
}
export const fetchBatch = (base: string, root: Hex) => getJson<BatchReceipts>(hostUrl(base, `/v1/batches/${root}`));

/// POST /v1/sponsor/cosignk: the host pays the gas for a per-app key's cosignK.
export const sponsorCosignK = (base: string, receiptHash: Hex, signature: Hex) =>
  getJson<{ txHash: Hex; signer: Hex }>(hostUrl(base, "/v1/sponsor/cosignk"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ receiptHash, signature }),
  });

export interface SponsoredFeedback {
  account: Hex;
  call: { data: Hex; nonce: string; deadline: string; signature: Hex };
  authorization?: { address: Hex; chainId: number; nonce: number; r: Hex; s: Hex; yParity: number };
}
/// POST /v1/sponsor/feedback: ERC-8004 feedback sent from the per-app address, gas paid by the host.
export const sponsorFeedback = (base: string, body: SponsoredFeedback) =>
  getJson<{ txHash: Hex; account: Hex }>(hostUrl(base, "/v1/sponsor/feedback"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/// POST /v1/cosign. Indexes are bigints in the SDK; JSON carries them as decimal strings.
export function relayCosign(base: string, receiptHash: Hex, qx: Hex, qy: Hex, auth: WebAuthnAuth) {
  const body = { receiptHash, qx, qy, auth: { ...auth, challengeIndex: auth.challengeIndex.toString(), typeIndex: auth.typeIndex.toString() } };
  return getJson<{ txHash: Hex }>(hostUrl(base, "/v1/cosign"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
