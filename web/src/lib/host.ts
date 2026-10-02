import type { ReceiptBody, VerifyInput, WebAuthnAuth } from "@assay/receipts";
import type { Hex } from "viem";

export const hostUrl = (base: string, path: string) => `${base.trim().replace(/\/+$/, "")}${path}`;

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}${json.error?.message ? `, ${json.error.message}` : ""}`);
  return json;
}

export const fetchJwks = (base: string) => getJson<VerifyInput["jwks"]>(hostUrl(base, "/.well-known/jwks.json"));

export type ReceiptStatus =
  | { status: "pending" }
  | { status: "anchored"; body: ReceiptBody; jws: string; root: Hex; proof: Hex[]; anchorTx?: Hex; reproduce?: { cast?: string } };

export const fetchReceiptStatus = (base: string, hash: Hex) => getJson<ReceiptStatus>(hostUrl(base, `/v1/receipts/${hash}`));

/// POST /v1/cosign. Indexes are bigints in the SDK; JSON carries them as decimal strings.
export function relayCosign(base: string, receiptHash: Hex, qx: Hex, qy: Hex, auth: WebAuthnAuth) {
  const body = { receiptHash, qx, qy, auth: { ...auth, challengeIndex: auth.challengeIndex.toString(), typeIndex: auth.typeIndex.toString() } };
  return getJson<{ txHash: Hex }>(hostUrl(base, "/v1/cosign"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
