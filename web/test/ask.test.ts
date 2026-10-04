// @vitest-environment happy-dom
import type { Passkey, ReceiptBody } from "@assay/receipts";
import { describe, expect, it } from "vitest";
import { answerText, bundleOf, canCosign, wrapOptions } from "../src/views/ask.js";

const pk = { keyHash: `0x${"ab".repeat(32)}` } as unknown as Passkey;
const body = (cosigner?: string) => ({ req: { cosigner } }) as unknown as ReceiptBody;
const r = { receipt: { body: body(), jws: "a.b.c" }, salt: `0x${"11".repeat(32)}` as const };

describe("ask", () => {
  it("hides the model's <thought> block but keeps it available", () => {
    expect(answerText("<thought>\n* Mars.\n</thought>Mars")).toEqual({ shown: "Mars", thought: "* Mars." });
    expect(answerText("Just text")).toEqual({ shown: "Just text", thought: null });
  });

  it("sends no co-signer when the user opts out or has no passkey", () => {
    expect(wrapOptions(pk, true)).toEqual({});
    expect(wrapOptions(null, false)).toEqual({});
    expect(wrapOptions(pk, false)).toEqual({ cosigner: pk.keyHash });
  });

  it("bundles exactly what's needed to verify later, plus the proof once anchored", () => {
    expect(Object.keys(bundleOf(r, "Mars", []))).toEqual(["body", "jws", "salt", "output", "messages"]);
    expect(bundleOf(r, "Mars", []).salt).toBe(r.salt);
    const anchored = bundleOf(r, "Mars", [], { root: `0x${"22".repeat(32)}`, proof: [] });
    expect(Object.keys(anchored)).toEqual(["body", "jws", "salt", "output", "messages", "root", "proof"]);
  });

  it("unlocks co-signing only once anchored and only for the key the receipt names", () => {
    const anchored = { status: "anchored" } as never;
    expect(canCosign({ status: "pending" }, body(pk.keyHash), pk)).toBe(false);
    expect(canCosign(anchored, body(pk.keyHash), pk)).toBe(true);
    expect(canCosign(anchored, body(`0x${"cd".repeat(32)}`), pk)).toBe(false);
    expect(canCosign(anchored, body(pk.keyHash), null)).toBe(false);
  });
});
