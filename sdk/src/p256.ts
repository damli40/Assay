import { bytesToHex, hexToBigInt, toHex, type Hex } from "viem";

/// P-256 group order.
export const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

export interface Signature {
  r: Hex;
  s: Hex;
}

/// OpenZeppelin's P256 rejects s > N/2. WebCrypto and passkeys return high s about half the time.
export function normalizeS(sig: Signature): Signature & { wasHighS: boolean } {
  const s = hexToBigInt(sig.s);
  const wasHighS = s > P256_N / 2n;
  return { r: sig.r, s: wasHighS ? toHex(P256_N - s, { size: 32 }) : sig.s, wasHighS };
}

/// WebCrypto's ECDSA output: raw r || s, 64 bytes.
export function splitRawSignature(raw: Uint8Array): Signature {
  if (raw.length !== 64) throw new Error(`raw signature must be 64 bytes, got ${raw.length}`);
  return { r: bytesToHex(raw.slice(0, 32)), s: bytesToHex(raw.slice(32)) };
}

/// WebAuthn assertions are ASN.1 DER: 30 len 02 len r 02 len s. Returns raw r || s (64 bytes).
export function derToRaw(der: Uint8Array): Uint8Array {
  const fail = (why: string): never => {
    throw new Error(`invalid DER signature: ${why}`);
  };
  if (der.length < 8 || der[0] !== 0x30) fail("no SEQUENCE");
  if (der[1] !== der.length - 2) fail("SEQUENCE length mismatch");

  const out = new Uint8Array(64);
  let i = 2;
  for (const offset of [0, 32]) {
    if (der[i] !== 0x02) fail("no INTEGER");
    const len = der[i + 1];
    if (len === 0 || len > 33 || i + 2 + len > der.length) fail("bad INTEGER length");
    let int = der.slice(i + 2, i + 2 + len);
    // A 33-byte INTEGER is only valid with a 0x00 sign byte in front of a value whose top bit is set.
    if (len === 33) {
      if (int[0] !== 0x00) fail("INTEGER too long");
      int = int.slice(1);
    }
    out.set(int, offset + 32 - int.length); // short INTEGERs are left-padded
    i += 2 + len;
  }
  if (i !== der.length) fail("trailing bytes");
  return out;
}

// DER prefix of every P-256 SubjectPublicKeyInfo (id-ecPublicKey, prime256v1, uncompressed point).
const SPKI_PREFIX = Uint8Array.from(
  "3059301306072a8648ce3d020106082a8648ce3d030107034200".match(/../g)!.map((b) => parseInt(b, 16)),
);

/// `getPublicKey()` on a WebAuthn credential returns DER SPKI (91 bytes for P-256).
export function spkiToXY(spki: Uint8Array): { x: Hex; y: Hex } {
  if (spki.length !== 91 || SPKI_PREFIX.some((b, i) => spki[i] !== b)) throw new Error("not a P-256 SPKI public key");
  return rawPubToXY(spki.slice(26));
}

/// WebCrypto `exportKey("raw")`: 0x04 || x || y, 65 bytes.
export function rawPubToXY(raw: Uint8Array): { x: Hex; y: Hex } {
  if (raw.length !== 65 || raw[0] !== 0x04) throw new Error("not an uncompressed P-256 point");
  return { x: bytesToHex(raw.slice(1, 33)), y: bytesToHex(raw.slice(33)) };
}
