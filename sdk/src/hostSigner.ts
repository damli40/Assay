import { CompactSign, compactVerify, createLocalJWKSet, importJWK, type JWK } from "jose";
import { encodeAbiParameters, hexToBytes, keccak256, stringToBytes, stringToHex, type Address, type Hex } from "viem";
import { jcs } from "./jcs.js";
import { normalizeS, splitRawSignature, type Signature } from "./p256.js";
import type { ReceiptBody } from "./receipt.js";

export const ANCHOR_TAG = keccak256(stringToHex("assay-anchor/0"));

export interface AnchorParams {
  chainId: bigint;
  anchor: Address;
  agentId: bigint;
  root: Hex;
  count: number;
}

/// Same bytes as ReceiptAnchor.anchorMessage.
export function anchorMessage(p: AnchorParams): Hex {
  return encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "bytes32" }, { type: "uint32" }],
    [ANCHOR_TAG, p.chainId, p.anchor, p.agentId, p.root, p.count],
  );
}

export interface HostSigner {
  kid: string;
  publicJwk: JWK;
  signReceipt(body: ReceiptBody): Promise<string>;
  signAnchor(p: AnchorParams): Promise<Signature>;
}

/// `privateJwk` is an ES256 (P-256) private key in JWK form, e.g. from host/scripts/keygen.ts.
export async function createHostSigner(privateJwk: JWK, kid: string): Promise<HostSigner> {
  if (privateJwk.kty !== "EC" || privateJwk.crv !== "P-256" || !privateJwk.d) throw new Error("expected a P-256 private JWK");
  const joseKey = await importJWK(privateJwk, "ES256");
  const webKey = await crypto.subtle.importKey("jwk", privateJwk as JsonWebKey, { name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
  ]);
  const { d: _d, ...pub } = privateJwk;
  const publicJwk: JWK = { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y, kid, alg: "ES256", use: "sig" };

  return {
    kid,
    publicJwk,
    // The payload is the JCS bytes of the body, so anyone can recompute receiptHash from it.
    signReceipt: (body) => new CompactSign(stringToBytes(jcs(body))).setProtectedHeader({ alg: "ES256", kid }).sign(joseKey),
    async signAnchor(p) {
      // WebCrypto hashes the message with SHA-256 itself, matching sha256(anchorMessage) onchain.
      const raw = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, webKey, new Uint8Array(hexToBytes(anchorMessage(p))));
      const { r, s } = normalizeS(splitRawSignature(new Uint8Array(raw)));
      return { r, s };
    },
  };
}

/// Verifies a receipt JWS against a JWKS and returns the signed body. Only ES256 is accepted.
export async function verifyReceiptJws(jws: string, jwks: { keys: JWK[] }): Promise<{ body: ReceiptBody; kid: string }> {
  const { payload, protectedHeader } = await compactVerify(jws, createLocalJWKSet(jwks), { algorithms: ["ES256"] });
  const body = JSON.parse(new TextDecoder().decode(payload)) as ReceiptBody;
  if (jcs(body) !== new TextDecoder().decode(payload)) throw new Error("receipt JWS payload is not canonical JSON");
  return { body, kid: protectedHeader.kid ?? "" };
}
