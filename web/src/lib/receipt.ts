import type { ReceiptBody } from "@assay/receipts";
import { isHex, type Hex } from "viem";

export interface HeldReceipt {
  body: ReceiptBody;
  jws: string;
}

function fromBase64url(s: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error("not base64url");
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
}

export function toBase64url(text: string): string {
  let bin = "";
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/// Accepts the X-Assay-Receipt header value (base64url of {body, jws}) or the JSON itself, e.g. a GET /v1/receipts/:hash response.
export function parseReceipt(input: string): HeldReceipt {
  const text = input.trim();
  if (!text) throw new Error("Paste a receipt first.");
  let json: string;
  try {
    json = text.startsWith("{") ? text : fromBase64url(text);
  } catch {
    throw new Error("The receipt is neither JSON nor base64url.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("The receipt does not decode to valid JSON.");
  }
  const r = parsed as Partial<HeldReceipt> | null;
  if (!r || typeof r !== "object" || typeof r.body !== "object" || r.body === null || typeof r.jws !== "string") {
    throw new Error("The receipt must have a `body` object and a `jws` string.");
  }
  if (r.body.v !== "assay-receipt/0") throw new Error(`Unknown receipt version: ${String(r.body.v)}`);
  if (r.jws.split(".").length !== 3) throw new Error("The `jws` is not a compact JWS (three dot-separated parts).");
  return { body: r.body, jws: r.jws };
}

/// 64 hex with or without 0x (the host accepts both), returned as 0x-prefixed lowercase.
export function parseSalt(input: string): Hex {
  const s = input.trim().toLowerCase();
  const hex = (s.startsWith("0x") ? s : `0x${s}`) as Hex;
  if (hex.length !== 66 || !isHex(hex)) throw new Error("The salt must be 32 bytes: 64 hex characters.");
  return hex;
}

/// Receipts this tab made (Ask) or unlocked (Vault), by hash. Memory only: gone on reload.
const held = new Map<string, HeldReceipt>();
export const rememberReceipt = (hash: string, r: HeldReceipt) => held.set(hash.toLowerCase(), r);
export const heldReceipt = (hash: string) => held.get(hash.toLowerCase());

/// "Verify with your salt" hands the receipt to the Verify form in memory, never through the URL.
let verifyPrefill: string | undefined;
export const setVerifyPrefill = (text: string) => (verifyPrefill = text);
export function takeVerifyPrefill() {
  const t = verifyPrefill;
  verifyPrefill = undefined;
  return t;
}
