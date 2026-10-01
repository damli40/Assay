import { createPublicKey, verify, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { CompactSign, importJWK, type JWK } from "jose";
import { hexToBigInt, hexToBytes, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { anchorMessage, createHostSigner, verifyReceiptJws } from "../src/hostSigner.js";
import { P256_N } from "../src/p256.js";
import { buildReceipt, receiptHash } from "../src/receipt.js";

async function newPrivateJwk(): Promise<JWK> {
  const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  return (await webcrypto.subtle.exportKey("jwk", pair.privateKey)) as JWK;
}

const b32 = (byte: string) => ("0x" + byte.repeat(32)) as Hex;
const body = buildReceipt({
  model: "z-ai/glm-5.3",
  host: { agentId: "erc8004:10143:1962", keyId: "host-key-2026-10", alg: "ES256" },
  req: { commit: b32("aa"), params: { temperature: 0, max_tokens: 16 } },
  res: { commit: b32("bb"), tokensIn: 12, tokensOut: 3, finish: "stop" },
  t: 1790500000000,
});
const fixture = JSON.parse(readFileSync(new URL("../../contracts/test/fixtures/webcrypto.json", import.meta.url), "utf8"));

describe("receipt JWS", () => {
  it("signs and verifies against the host's JWKS, and the payload rebuilds receiptHash", async () => {
    const host = await createHostSigner(await newPrivateJwk(), "host-key-2026-10");
    const jws = await host.signReceipt(body);
    const out = await verifyReceiptJws(jws, { keys: [host.publicJwk] });
    expect(out.kid).toBe("host-key-2026-10");
    expect(receiptHash(out.body)).toBe(receiptHash(body));
    expect(host.publicJwk).not.toHaveProperty("d");
  });

  it("fails when one character of the payload changes", async () => {
    const host = await createHostSigner(await newPrivateJwk(), "k1");
    const [h, p, s] = (await host.signReceipt(body)).split(".");
    const flipped = p.slice(0, 10) + (p[10] === "A" ? "B" : "A") + p.slice(11);
    await expect(verifyReceiptJws([h, flipped, s].join("."), { keys: [host.publicJwk] })).rejects.toThrow();
  });

  it("fails when the JWKS has no key with that kid", async () => {
    const host = await createHostSigner(await newPrivateJwk(), "k1");
    const jws = await host.signReceipt(body);
    await expect(verifyReceiptJws(jws, { keys: [{ ...host.publicJwk, kid: "k2" }] })).rejects.toThrow();
  });

  it("fails when a different key is published under the same kid", async () => {
    const host = await createHostSigner(await newPrivateJwk(), "k1");
    const impostor = await createHostSigner(await newPrivateJwk(), "k1");
    const jws = await impostor.signReceipt(body);
    await expect(verifyReceiptJws(jws, { keys: [host.publicJwk] })).rejects.toThrow();
  });

  it('rejects alg "none"', async () => {
    const host = await createHostSigner(await newPrivateJwk(), "k1");
    const header = Buffer.from(JSON.stringify({ alg: "none", kid: "k1" })).toString("base64url");
    const payload = (await host.signReceipt(body)).split(".")[1];
    await expect(verifyReceiptJws(`${header}.${payload}.`, { keys: [host.publicJwk] })).rejects.toThrow();
  });

  it("rejects a validly signed payload that isn't canonical JSON", async () => {
    const priv = await newPrivateJwk();
    const host = await createHostSigner(priv, "k1");
    const reordered = JSON.stringify({ t: body.t, ...body }); // same object, different key order
    const jws = await new CompactSign(new TextEncoder().encode(reordered))
      .setProtectedHeader({ alg: "ES256", kid: "k1" })
      .sign(await importJWK(priv, "ES256"));
    await expect(verifyReceiptJws(jws, { keys: [host.publicJwk] })).rejects.toThrow(/canonical/);
  });

  it("refuses a public JWK as the signing key", async () => {
    const host = await createHostSigner(await newPrivateJwk(), "k1");
    await expect(createHostSigner(host.publicJwk, "k1")).rejects.toThrow(/private/);
  });
});

describe("anchor signatures", () => {
  it("anchorMessage matches the bytes the Solidity fixture checks", () => {
    const a = fixture.anchor;
    expect(
      anchorMessage({
        chainId: BigInt(a.chainId),
        anchor: a.address,
        agentId: BigInt(a.agentId),
        root: fixture.merkle.root,
        count: a.count,
      }),
    ).toBe(a.message);
  });

  it("signAnchor is ES256 over anchorMessage, always low-s", async () => {
    const priv = await newPrivateJwk();
    const host = await createHostSigner(priv, "k1");
    const pub = createPublicKey({ key: host.publicJwk as webcrypto.JsonWebKey, format: "jwk" });
    for (let i = 0; i < 32; i++) {
      const p = { chainId: 10143n, anchor: "0x049A73755cA3508ef3Daa4752A3406f6e00CfB13" as const, agentId: 1962n, root: b32(i.toString(16).padStart(2, "0")), count: i + 1 };
      const { r, s } = await host.signAnchor(p);
      expect(hexToBigInt(s) <= P256_N / 2n).toBe(true);
      const sig = Buffer.concat([hexToBytes(r), hexToBytes(s)]);
      expect(verify("sha256", hexToBytes(anchorMessage(p)), { key: pub, dsaEncoding: "ieee-p1363" }, sig)).toBe(true);
    }
  });
});
