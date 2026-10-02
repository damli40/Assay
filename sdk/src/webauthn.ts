import { base64url } from "jose";
import { bytesToHex, encodeAbiParameters, hexToBytes, keccak256, sha256, type Hex } from "viem";
import { derToRaw, normalizeS, spkiToXY, splitRawSignature } from "./p256.js";

/// OpenZeppelin WebAuthn.WebAuthnAuth, ready to pass to ReceiptAnchor.cosign.
export interface WebAuthnAuth {
  r: Hex;
  s: Hex;
  challengeIndex: bigint;
  typeIndex: bigint;
  authenticatorData: Hex;
  clientDataJSON: string;
}

export interface AssertionResponse {
  authenticatorData: ArrayBuffer | Uint8Array;
  clientDataJSON: ArrayBuffer | Uint8Array;
  signature: ArrayBuffer | Uint8Array;
}

const bytes = (b: ArrayBuffer | Uint8Array) => (b instanceof Uint8Array ? b : new Uint8Array(b));
const utf8Index = (s: string, charIndex: number) => new TextEncoder().encode(s.slice(0, charIndex)).length;

/// Byte offsets of `"type":"webauthn.get"` and `"challenge":"` as OZ WebAuthn expects them. Browsers may reorder keys or add
/// extra ones (crossOrigin, other_keys_can_be_added_here), so they are searched for, never assumed.
export function findClientDataIndexes(clientDataJSON: string): { typeIndex: bigint; challengeIndex: bigint } {
  const parsed = JSON.parse(clientDataJSON) as { type?: unknown; challenge?: unknown };
  if (parsed.type !== "webauthn.get") throw new Error("clientDataJSON type is not webauthn.get");
  if (typeof parsed.challenge !== "string") throw new Error("clientDataJSON has no challenge");

  const typeAt = clientDataJSON.indexOf('"type":"webauthn.get"');
  // Include the value so the index points at the challenge the parser saw, not at a lookalike.
  const challengeAt = clientDataJSON.indexOf(`"challenge":"${parsed.challenge}"`);
  if (typeAt < 0 || challengeAt < 0) throw new Error("clientDataJSON is not in the compact form OZ WebAuthn expects");
  return { typeIndex: BigInt(utf8Index(clientDataJSON, typeAt)), challengeIndex: BigInt(utf8Index(clientDataJSON, challengeAt)) };
}

/// Browser assertion → WebAuthnAuth. The DER signature becomes raw r, s with s normalized low (OZ P256 rejects high s).
export function assertionToWebAuthnAuth(response: AssertionResponse): WebAuthnAuth {
  const clientDataJSON = new TextDecoder().decode(bytes(response.clientDataJSON));
  const { r, s } = normalizeS(splitRawSignature(derToRaw(bytes(response.signature))));
  return {
    r,
    s,
    ...findClientDataIndexes(clientDataJSON),
    authenticatorData: bytesToHex(bytes(response.authenticatorData)),
    clientDataJSON,
  };
}

/// OZ WebAuthn does not check the origin, so verifiers must.
export function checkOrigin(clientDataJSON: string, expectedOrigin: string): boolean {
  return (JSON.parse(clientDataJSON) as { origin?: unknown }).origin === expectedOrigin;
}

/// OZ WebAuthn does not check the rpIdHash (authenticatorData bytes 0..32), so verifiers must.
export function checkRpIdHash(authenticatorData: Hex | Uint8Array, rpId: string): boolean {
  const data = typeof authenticatorData === "string" ? hexToBytes(authenticatorData) : authenticatorData;
  return data.length >= 37 && bytesToHex(data.slice(0, 32)) === sha256(new TextEncoder().encode(rpId));
}

/// Same as ReceiptAnchor.keyHashOf: keccak256(abi.encode(qx, qy)). This is the value for X-Assay-Cosigner.
export function requesterKeyHash(qx: Hex, qy: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [qx, qy]));
}

/// The subset of `navigator.credentials` used here; tests pass a fake.
export interface PasskeyCredentials {
  create(options: { publicKey: PublicKeyCredentialCreationOptions }): Promise<unknown>;
  get(options: { publicKey: PublicKeyCredentialRequestOptions }): Promise<unknown>;
}

export interface Passkey {
  credentialId: string;
  qx: Hex;
  qy: Hex;
  keyHash: Hex;
}

function defaultCredentials(): PasskeyCredentials {
  const c = (globalThis as { navigator?: { credentials?: PasskeyCredentials } }).navigator?.credentials;
  if (!c) throw new Error("no navigator.credentials: pass `credentials` explicitly");
  return c;
}

const ES256 = -7;

export async function registerPasskey(opts: { rpId: string; userName: string; credentials?: PasskeyCredentials }): Promise<Passkey> {
  const cred = (await (opts.credentials ?? defaultCredentials()).create({
    publicKey: {
      rp: { id: opts.rpId, name: opts.rpId },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: opts.userName, displayName: opts.userName },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [{ type: "public-key", alg: ES256 }],
      authenticatorSelection: { userVerification: "required", residentKey: "preferred" },
      attestation: "none",
    },
  })) as { rawId: ArrayBuffer; response: { getPublicKey(): ArrayBuffer | null; getPublicKeyAlgorithm(): number } } | null;
  if (!cred) throw new Error("passkey creation was cancelled");
  if (cred.response.getPublicKeyAlgorithm() !== ES256) throw new Error("passkey is not ES256 (P-256)");
  const spki = cred.response.getPublicKey();
  if (!spki) throw new Error("authenticator returned no public key");
  const { x: qx, y: qy } = spkiToXY(new Uint8Array(spki));
  return { credentialId: base64url.encode(new Uint8Array(cred.rawId)), qx, qy, keyHash: requesterKeyHash(qx, qy) };
}

/// Signs `receiptHash` (the raw 32 bytes are the WebAuthn challenge) and returns the args for ReceiptAnchor.cosign.
export async function cosignReceipt(
  receiptHash: Hex,
  opts: { rpId: string; credentialId: string; credentials?: PasskeyCredentials },
): Promise<WebAuthnAuth> {
  const cred = (await (opts.credentials ?? defaultCredentials()).get({
    publicKey: {
      challenge: new Uint8Array(hexToBytes(receiptHash)),
      rpId: opts.rpId,
      allowCredentials: [{ type: "public-key", id: new Uint8Array(base64url.decode(opts.credentialId)) }],
      userVerification: "required",
    },
  })) as { response: AssertionResponse } | null;
  if (!cred) throw new Error("passkey assertion was cancelled");
  const auth = assertionToWebAuthnAuth(cred.response);
  if (!checkRpIdHash(auth.authenticatorData, opts.rpId)) throw new Error("assertion rpIdHash does not match rpId");
  return auth;
}
