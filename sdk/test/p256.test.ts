import { generateKeyPairSync, randomBytes, sign, verify, webcrypto } from "node:crypto";
import { hexToBigInt, hexToBytes } from "viem";
import { describe, expect, it } from "vitest";
import { P256_N, derToRaw, normalizeS, rawPubToXY, splitRawSignature, spkiToXY } from "../src/p256.js";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const toRaw = (r: `0x${string}`, s: `0x${string}`) => Buffer.concat([hexToBytes(r), hexToBytes(s)]);
const verifiesRaw = (data: Buffer, raw: Buffer) =>
  verify("sha256", data, { key: publicKey, dsaEncoding: "ieee-p1363" }, raw);

describe("normalizeS", () => {
  it("flips high s, leaves low s, and both still verify", () => {
    let sawHigh = false;
    let sawLow = false;
    for (let i = 0; i < 64; i++) {
      const data = randomBytes(32);
      const sig = splitRawSignature(sign("sha256", data, { key: privateKey, dsaEncoding: "ieee-p1363" }));
      const n = normalizeS(sig);
      expect(hexToBigInt(n.s) <= P256_N / 2n).toBe(true);
      if (n.wasHighS) {
        sawHigh = true;
        expect(hexToBigInt(n.s)).toBe(P256_N - hexToBigInt(sig.s));
      } else {
        sawLow = true;
        expect(n.s).toBe(sig.s);
      }
      expect(verifiesRaw(data, toRaw(n.r, n.s))).toBe(true);
    }
    expect(sawHigh && sawLow).toBe(true);
  });
});

describe("derToRaw", () => {
  it("round-trips 500 OpenSSL DER signatures", () => {
    for (let i = 0; i < 500; i++) {
      const data = randomBytes(32);
      const der = sign("sha256", data, { key: privateKey, dsaEncoding: "der" });
      const raw = derToRaw(der);
      expect(raw.length).toBe(64);
      expect(verifiesRaw(data, Buffer.from(raw))).toBe(true);
    }
  });

  it("left-pads short INTEGERs and strips the 0x00 sign byte", () => {
    // r = 0x01 (1 byte), s = 0x80 followed by 31 bytes of 0x11 (needs a 0x00 sign byte: 33 bytes).
    const s = [0x80, ...Array(31).fill(0x11)];
    const der = Uint8Array.from([0x30, 3 + 2 + 33, 0x02, 0x01, 0x01, 0x02, 0x21, 0x00, ...s]);
    const raw = derToRaw(der);
    expect(Array.from(raw.slice(0, 32))).toEqual([...Array(31).fill(0), 1]);
    expect(Array.from(raw.slice(32))).toEqual(s);
  });

  it.each([
    ["empty", []],
    ["not a SEQUENCE", [0x31, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01]],
    ["wrong SEQUENCE length", [0x30, 0x07, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01]],
    ["trailing bytes", [0x30, 0x07, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01, 0x00]],
    ["33-byte INTEGER without sign byte", [0x30, 0x26, 0x02, 0x21, ...Array(33).fill(0x7f), 0x02, 0x01, 0x01]],
    ["INTEGER runs past the end", [0x30, 0x06, 0x02, 0x05, 0x01, 0x02, 0x01, 0x01]],
  ])("rejects %s", (_, bytes) => {
    expect(() => derToRaw(Uint8Array.from(bytes as number[]))).toThrow(/DER/);
  });
});

describe("public keys", () => {
  it("spkiToXY and rawPubToXY agree on a WebCrypto key", async () => {
    const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
    const spki = new Uint8Array(await webcrypto.subtle.exportKey("spki", pair.publicKey));
    const raw = new Uint8Array(await webcrypto.subtle.exportKey("raw", pair.publicKey));
    const fromSpki = spkiToXY(spki);
    expect(fromSpki).toEqual(rawPubToXY(raw));
    expect(fromSpki.x).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("rejects non-P-256 SPKI and compressed points", () => {
    const ed = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" });
    expect(() => spkiToXY(new Uint8Array(ed))).toThrow(/P-256/);
    expect(() => rawPubToXY(new Uint8Array(33).fill(2))).toThrow(/uncompressed/);
  });

  it("rejects a 91-byte SPKI whose curve OID isn't P-256", async () => {
    const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
    const spki = new Uint8Array(await webcrypto.subtle.exportKey("spki", pair.publicKey));
    spki[24] ^= 0xff; // last byte of the prime256v1 OID
    expect(() => spkiToXY(spki)).toThrow(/P-256/);
  });

  it("rejects a raw signature that isn't 64 bytes", () => {
    expect(() => splitRawSignature(new Uint8Array(63))).toThrow(/64 bytes/);
  });
});
