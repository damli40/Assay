import { createHash, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { base64url } from "jose";
import { bytesToHex, hexToBigInt, hexToBytes, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { P256_N } from "../src/p256.js";
import {
  assertionToWebAuthnAuth,
  checkOrigin,
  checkRpIdHash,
  cosignReceipt,
  findClientDataIndexes,
  registerPasskey,
  requesterKeyHash,
  type PasskeyCredentials,
  type WebAuthnAuth,
} from "../src/webauthn.js";

const RECEIPT = ("0x" + "a1".repeat(32)) as Hex;
const RP_ID = "assay.example";
const ORIGIN = "https://assay.example";
const sha = (...parts: Uint8Array[]) => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
};
const b64 = (h: Hex) => base64url.encode(hexToBytes(h));

// Same layout as ReceiptAnchor.t.sol `_assertion`: sha256(rpId) || flags || uint32 counter.
const authData = (flags = 0x05, rpId = RP_ID) => new Uint8Array([...sha(new TextEncoder().encode(rpId)), flags, 0, 0, 0, 1]);
const clientData = (challenge: Hex) =>
  `{"type":"webauthn.get","challenge":"${b64(challenge)}","origin":"${ORIGIN}","crossOrigin":false}`;

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  return { privateKey, publicKey, qx: bytesToHex(base64url.decode(jwk.x!)), qy: bytesToHex(base64url.decode(jwk.y!)) };
}

// node:crypto signs sha256(authData || sha256(cdj)) and returns DER, exactly like an authenticator.
function assertion(privateKey: KeyObject, cdj: string, data = authData()) {
  const clientDataJSON = new TextEncoder().encode(cdj);
  const signature = new Uint8Array(sign("sha256", Buffer.concat([data, sha(clientDataJSON)]), privateKey));
  return { authenticatorData: data, clientDataJSON, signature };
}

// Mirrors OZ WebAuthn.verify minus the precompile: type and challenge slices, UP/UV flags, P-256 over the same digest.
function ozAccepts(auth: WebAuthnAuth, challenge: Hex, publicKey: KeyObject): boolean {
  const cdj = new TextEncoder().encode(auth.clientDataJSON);
  const at = (i: bigint, s: string) => new TextDecoder().decode(cdj.slice(Number(i), Number(i) + s.length)) === s;
  const data = hexToBytes(auth.authenticatorData);
  const flagsOk = (data[32] & 0x05) === 0x05;
  const sig = hexToBytes(`0x${auth.r.slice(2)}${auth.s.slice(2)}`);
  const sigOk = verify("sha256", Buffer.concat([data, sha(cdj)]), { key: publicKey, dsaEncoding: "ieee-p1363" }, sig);
  return (
    at(auth.typeIndex, '"type":"webauthn.get"') &&
    at(auth.challengeIndex, `"challenge":"${b64(challenge)}"`) &&
    flagsOk &&
    hexToBigInt(auth.s) <= P256_N / 2n &&
    sigOk
  );
}

describe("findClientDataIndexes", () => {
  it("matches the indexes the contract tests hardcode", () => {
    expect(findClientDataIndexes(clientData(RECEIPT))).toEqual({ typeIndex: 1n, challengeIndex: 23n });
  });

  it.each([
    `{"challenge":"${b64(RECEIPT)}","origin":"${ORIGIN}","type":"webauthn.get"}`,
    `{"type":"webauthn.get","challenge":"${b64(RECEIPT)}","origin":"${ORIGIN}","crossOrigin":false,"other_keys_can_be_added_here":"do not compare clientDataJSON against a template. See https://goo.gl/yabPex"}`,
    `{"origin":"https://bücher.example","crossOrigin":false,"type":"webauthn.get","challenge":"${b64(RECEIPT)}"}`,
  ])("computes byte offsets for %s", (cdj) => {
    const { typeIndex, challengeIndex } = findClientDataIndexes(cdj);
    const raw = Buffer.from(cdj, "utf8");
    expect(raw.subarray(Number(typeIndex)).toString().startsWith('"type":"webauthn.get"')).toBe(true);
    expect(raw.subarray(Number(challengeIndex)).toString().startsWith(`"challenge":"${b64(RECEIPT)}"`)).toBe(true);
  });

  it("rejects a create (registration) clientDataJSON", () => {
    expect(() => findClientDataIndexes(`{"type":"webauthn.create","challenge":"abc"}`)).toThrow(/webauthn.get/);
  });

  it("rejects clientDataJSON that isn't in compact form", () => {
    expect(() => findClientDataIndexes(`{"type": "webauthn.get", "challenge": "abc"}`)).toThrow(/compact/);
  });
});

describe("assertionToWebAuthnAuth", () => {
  it("builds an assertion the contract's WebAuthn check accepts, including after s normalization", () => {
    const key = keyPair();
    let sawHighS = false;
    for (let i = 0; i < 16; i++) {
      const a = assertion(key.privateKey, clientData(RECEIPT));
      const der = a.signature;
      const sLen = der[3 + der[3] + 2];
      const s = der.slice(der.length - sLen);
      if (BigInt(bytesToHex(s)) > P256_N / 2n) sawHighS = true;

      const auth = assertionToWebAuthnAuth(a);
      expect(auth.clientDataJSON).toBe(clientData(RECEIPT));
      expect(auth.authenticatorData).toBe(bytesToHex(authData()));
      expect(ozAccepts(auth, RECEIPT, key.publicKey)).toBe(true);
    }
    expect(sawHighS).toBe(true); // 16 tries at 50% each; otherwise normalization went untested
  });

  it("fails the OZ check for a different challenge or another key", () => {
    const key = keyPair();
    const auth = assertionToWebAuthnAuth(assertion(key.privateKey, clientData(RECEIPT)));
    expect(ozAccepts(auth, ("0x" + "b2".repeat(32)) as Hex, key.publicKey)).toBe(false);
    expect(ozAccepts(auth, RECEIPT, keyPair().publicKey)).toBe(false);
  });
});

describe("offchain checks OZ skips", () => {
  it("checks the origin exactly", () => {
    expect(checkOrigin(clientData(RECEIPT), ORIGIN)).toBe(true);
    expect(checkOrigin(clientData(RECEIPT), "https://evil.example")).toBe(false);
  });

  it("checks the rpIdHash", () => {
    expect(checkRpIdHash(authData(), RP_ID)).toBe(true);
    expect(checkRpIdHash(bytesToHex(authData()), RP_ID)).toBe(true);
    expect(checkRpIdHash(authData(0x05, "evil.example"), RP_ID)).toBe(false);
    expect(checkRpIdHash(authData().slice(0, 36), RP_ID)).toBe(false);
  });

  it("hashes the requester key like ReceiptAnchor.keyHashOf", () => {
    // abi.encode of two bytes32 is their concatenation: `cast keccak 0x11..1122..22`.
    expect(requesterKeyHash(("0x" + "11".repeat(32)) as Hex, ("0x" + "22".repeat(32)) as Hex)).toBe(
      "0x3e92e0db88d6afea9edc4eedf62fffa4d92bcdfc310dccbe943747fe8302e871",
    );
  });
});

describe("browser wrappers with a fake navigator.credentials", () => {
  function fakeAuthenticator() {
    const key = keyPair();
    const rawId = new Uint8Array([1, 2, 3, 4]);
    const calls: { create?: any; get?: any } = {};
    const spki = new Uint8Array(key.publicKey.export({ format: "der", type: "spki" }));
    const credentials: PasskeyCredentials = {
      async create(options) {
        calls.create = options;
        return { rawId: rawId.buffer, response: { getPublicKey: () => spki.buffer, getPublicKeyAlgorithm: () => -7 } };
      },
      async get(options) {
        calls.get = options;
        const challenge = bytesToHex(new Uint8Array(options.publicKey.challenge as Uint8Array));
        return { response: assertion(key.privateKey, clientData(challenge)) };
      },
    };
    return { key, rawId, calls, credentials };
  }

  it("registers a P-256 passkey with UV required and returns its key hash", async () => {
    const f = fakeAuthenticator();
    const pk = await registerPasskey({ rpId: RP_ID, userName: "alice", credentials: f.credentials });
    expect(pk).toEqual({
      credentialId: base64url.encode(f.rawId),
      qx: f.key.qx,
      qy: f.key.qy,
      keyHash: requesterKeyHash(f.key.qx, f.key.qy),
    });
    expect(f.calls.create.publicKey.pubKeyCredParams).toEqual([{ type: "public-key", alg: -7 }]);
    expect(f.calls.create.publicKey.authenticatorSelection.userVerification).toBe("required");
  });

  it("co-signs a receipt hash as the WebAuthn challenge", async () => {
    const f = fakeAuthenticator();
    const auth = await cosignReceipt(RECEIPT, { rpId: RP_ID, credentialId: base64url.encode(f.rawId), credentials: f.credentials });
    expect(bytesToHex(f.calls.get.publicKey.challenge)).toBe(RECEIPT);
    expect(f.calls.get.publicKey.userVerification).toBe("required");
    expect(ozAccepts(auth, RECEIPT, f.key.publicKey)).toBe(true);
  });

  it("refuses an assertion for a different rpId", async () => {
    const f = fakeAuthenticator();
    await expect(
      cosignReceipt(RECEIPT, { rpId: "other.example", credentialId: base64url.encode(f.rawId), credentials: f.credentials }),
    ).rejects.toThrow(/rpIdHash/);
  });

  it("refuses a non-ES256 passkey", async () => {
    const f = fakeAuthenticator();
    const credentials: PasskeyCredentials = {
      ...f.credentials,
      create: async () => ({ rawId: f.rawId.buffer, response: { getPublicKey: () => null, getPublicKeyAlgorithm: () => -8 } }),
    };
    await expect(registerPasskey({ rpId: RP_ID, userName: "alice", credentials })).rejects.toThrow(/ES256/);
  });
});
