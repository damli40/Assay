import { webcrypto } from "node:crypto";
import type { JWK } from "jose";
import type { Hex } from "viem";
import { describe, expect, it } from "vitest";
import { commitRequest, commitResponse, newSalt } from "../src/commit.js";
import { cosignerAddress, cosignerForAddress } from "../src/cosigner.js";
import { createHostSigner } from "../src/hostSigner.js";
import { buildReceipt, receiptHash } from "../src/receipt.js";
import { verifyReceipt, type ContractReader } from "../src/verify.js";
import { requesterKeyHash } from "../src/webauthn.js";

const ADDR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const ANCHOR = "0x049A73755cA3508ef3Daa4752A3406f6e00CfB13";

describe("cosigner encoding (D25)", () => {
  it("pads an address to 32 bytes and reads it back", () => {
    const c = cosignerForAddress(ADDR);
    expect(c).toBe("0x00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8");
    expect(cosignerAddress(c)).toBe(ADDR);
    expect(cosignerAddress(c.toUpperCase().replace("0X", "0x") as Hex)).toBe(ADDR);
  });

  it("treats a P-256 key hash as not an address", () => {
    const h = requesterKeyHash(("0x" + "11".repeat(32)) as Hex, ("0x" + "22".repeat(32)) as Hex);
    expect(cosignerAddress(h)).toBeNull();
  });
});

describe("verifyReceipt with a secp256k1 (cosignK) requester", () => {
  async function setup(onchainSigned: boolean) {
    const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
    const host = await createHostSigner((await webcrypto.subtle.exportKey("jwk", pair.privateKey)) as JWK, "k1");
    const salt = newSalt();
    const body = buildReceipt({
      model: "m",
      host: { agentId: "erc8004:10143:1962", keyId: "k1", alg: "ES256" },
      req: { commit: commitRequest(salt, [], {}), params: {}, cosigner: cosignerForAddress(ADDR) },
      res: { commit: commitResponse(salt, "OK"), tokensIn: 1, tokensOut: 1, finish: "stop" },
    });
    const hash = receiptHash(body);
    const calls: string[] = [];
    const client: ContractReader = {
      async readContract({ functionName, args }) {
        calls.push(functionName);
        if (functionName === "cosignedK") return onchainSigned && args[0] === hash && args[1] === ADDR;
        throw new Error(`unexpected ${functionName}`);
      },
    };
    const out = await verifyReceipt({
      body,
      jws: await host.signReceipt(body),
      jwks: { keys: [host.publicJwk] },
      onchain: { client, anchor: ANCHOR },
    });
    return { out, calls, hash };
  }

  it("reads cosignedK(receiptHash, address) and passes when it co-signed", async () => {
    const { out, calls, hash } = await setup(true);
    expect(calls).toEqual(["cosignedK"]);
    expect(out.checks.cosigned).toBe("pass");
    expect(out.reproduce.cosigned).toMatchObject({ function: "cosignedK(bytes32,address)(bool)", args: [hash, ADDR] });
  });

  it("fails when that address never co-signed", async () => {
    const { out } = await setup(false);
    expect(out.checks.cosigned).toBe("fail");
  });
});
