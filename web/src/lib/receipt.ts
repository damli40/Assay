import type { ReceiptBody } from "@assay/receipts";
import { isHex, type Hex } from "viem";

export interface HeldReceipt {
  body: ReceiptBody;
  jws: string;
}

/// What only the asker has: the salt and the plaintext. Kept in memory, never in the URL or localStorage.
export interface Opening {
  salt: Hex;
  output: string;
  messages: unknown;
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
const held = new Map<string, HeldReceipt & Partial<Opening>>();
export const rememberReceipt = (hash: string, r: HeldReceipt & Partial<Opening>) => held.set(hash.toLowerCase(), r);
export const heldReceipt = (hash: string) => held.get(hash.toLowerCase());

/// "Verify with your salt" hands the receipt (and the opening, if held) to the Verify form in memory, never through the URL.
export type VerifyPrefill = { receipt: string } & Partial<Opening>;
let verifyPrefill: VerifyPrefill | undefined;
export const setVerifyPrefill = (p: VerifyPrefill) => (verifyPrefill = p);
export function takeVerifyPrefill() {
  const t = verifyPrefill;
  verifyPrefill = undefined;
  return t;
}

/// A bundle file from Ask or the receipt page: the receipt plus, from the asker, its opening.
export function parseBundle(text: string): HeldReceipt & Partial<Opening> {
  const r = parseReceipt(text);
  const b = JSON.parse(text) as Partial<Opening>;
  return { ...r, ...(typeof b.salt === "string" ? { salt: parseSalt(b.salt) } : {}), ...(typeof b.output === "string" ? { output: b.output } : {}), ...(b.messages !== undefined ? { messages: b.messages } : {}) };
}

/// Receipts asked for in this browser, newest first. Hashes are public, so they may persist; salts never do.
export interface MyReceipt {
  hash: Hex;
  chainId: number;
  model: string;
  t: number;
}
const MINE = "assay.mine";
const MINE_MAX = 20;
export function myReceipts(): MyReceipt[] {
  try {
    const list = JSON.parse(localStorage.getItem(MINE) ?? "[]");
    return Array.isArray(list) ? list.filter((r) => isHex(r?.hash) && r.hash.length === 66 && Number.isInteger(r.chainId)) : [];
  } catch {
    return [];
  }
}
export function addMyReceipt(r: MyReceipt) {
  try {
    localStorage.setItem(MINE, JSON.stringify([r, ...myReceipts().filter((x) => x.hash !== r.hash)].slice(0, MINE_MAX)));
  } catch {
    // Private mode or storage blocked: the list is a convenience, the receipt is unaffected.
  }
}
