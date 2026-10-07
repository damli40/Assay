import { encodeAbiParameters, hashTypedData, keccak256, recoverTypedDataAddress, stringToBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { delegationCode, randomNonce, sponsoredCallTypedData } from "../src/index.js";

const key = `0x${"a11ce".padStart(64, "0")}` as Hex;
const account = privateKeyToAccount(key);
const call = { target: "0x8004B663056A597Dffe9eCcC1965A193B7388713", data: "0x1234", nonce: 7n, deadline: 1_800_000_000n } as const;

describe("sponsored calls (AssayAccount)", () => {
  it("hashes exactly as the contract does: OZ EIP712 domain, CALL_TYPEHASH, keccak of data", () => {
    const td = sponsoredCallTypedData(10143, account.address, call);
    const typeHash = keccak256(stringToBytes("Call(address target,bytes data,uint256 nonce,uint256 deadline)"));
    const domainSep = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
        [keccak256(stringToBytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")), keccak256(stringToBytes("AssayAccount")), keccak256(stringToBytes("1")), 10143n, account.address],
      ),
    );
    const structHash = keccak256(
      encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }], [typeHash, call.target, keccak256(call.data), call.nonce, call.deadline]),
    );
    expect(hashTypedData(td)).toBe(keccak256(`0x1901${domainSep.slice(2)}${structHash.slice(2)}`));
  });

  it("recovers to the per-app account that signed", async () => {
    const td = sponsoredCallTypedData(143, account.address, call);
    const signature = await account.signTypedData(td);
    expect(await recoverTypedDataAddress({ ...td, signature })).toBe(account.address);
  });

  it("makes 128-bit nonces and the 7702 delegation designator", () => {
    expect(randomNonce()).not.toBe(randomNonce());
    expect(randomNonce() < 2n ** 128n).toBe(true);
    expect(delegationCode("0x00000000000000000000000000000000000000Ab")).toBe("0xef010000000000000000000000000000000000000000ab");
  });
});
