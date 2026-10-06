import { readdirSync, readFileSync } from "node:fs";
import { compactVerify, decodeProtectedHeader, importJWK, type JWK } from "jose";
import { sha256, stringToBytes } from "viem";
import { describe, expect, it } from "vitest";
import { jcs } from "../src/jcs.js";

// Cross-implementation vectors, pinned offline so CI never depends on anyone's server.
// MonadGuard (github.com/poteshniy/monadguard) runs the same checks on our receipts in its CI
// with scripts/verify-foreign.mjs (their commit bbacb8b).
const MG = new URL("./fixtures/monadguard/", import.meta.url);
const OURS = new URL("../../docs/interop/assay-receipts/", import.meta.url);

/// The format both projects share: ES256 JWS, kid in the JWKS, payload = JCS bytes, hash = sha256(payload).
async function checkForeign(jws: string, jwks: { keys: JWK[] }, expectedHash: string) {
  const header = decodeProtectedHeader(jws);
  expect(header.alg).toBe("ES256");
  const key = jwks.keys.find((k) => k.kid === header.kid);
  expect(key, `kid ${header.kid} must be in the JWKS`).toBeDefined();
  expect(key!.crv).toBe("P-256");
  const { payload } = await compactVerify(jws, await importJWK(key!, "ES256"));
  const signed = new TextDecoder().decode(payload);
  // Not equivalent JSON: the exact signed bytes must be what our JCS produces.
  expect(jcs(JSON.parse(signed))).toBe(signed);
  expect(sha256(stringToBytes(signed))).toBe(expectedHash);
}

describe("interop: MonadGuard receipts (Monad mainnet)", () => {
  const jwks = JSON.parse(readFileSync(new URL("jwks.json", MG), "utf8"));
  const files = readdirSync(MG).filter((f) => f.endsWith(".jws"));

  it("has the three pinned receipts", () => expect(files).toHaveLength(3));

  // A suite that only ever sees valid input proves nothing: one changed payload byte must fail.
  it("rejects a copy with one payload byte changed", async () => {
    const f = files[0];
    const [h, p, sig] = readFileSync(new URL(f, MG), "utf8").trim().split(".");
    const bytes = Buffer.from(p, "base64url");
    bytes[bytes.length - 2] ^= 1;
    await expect(checkForeign(`${h}.${bytes.toString("base64url")}.${sig}`, jwks, f.replace(".jws", ""))).rejects.toThrow();
  });
  for (const f of files) {
    it(`verifies ${f.slice(0, 10)}…`, () => checkForeign(readFileSync(new URL(f, MG), "utf8").trim(), jwks, f.replace(".jws", "")));
  }
});

describe("interop: the Assay receipts we publish for other verifiers", () => {
  for (const f of readdirSync(OURS).filter((f) => f.endsWith(".json"))) {
    it(`verifies ${f.slice(0, 10)}…`, async () => {
      const r = JSON.parse(readFileSync(new URL(f, OURS), "utf8"));
      await checkForeign(r.jws, r.jwks, r.receiptHash);
    });
  }
});
