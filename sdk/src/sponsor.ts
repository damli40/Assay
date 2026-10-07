import { parseAbi, type Address, type Hex } from "viem";

/// AssayAccount: the EIP-7702 delegate that lets a relayer pay gas for calls a per-app key signed.
export const assayAccountAbi = parseAbi([
  "function execute(address target, bytes data, uint256 nonce, uint256 deadline, bytes signature) returns (bytes)",
  "function nonceUsed(uint256 nonce) view returns (bool)",
]);

/// The ERC-8004 ReputationRegistry call a sponsored complaint makes.
export const reputationAbi = parseAbi([
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
]);

export interface SponsoredCall {
  target: Address;
  data: Hex;
  nonce: bigint;
  deadline: bigint;
}

/// EIP-712 typed data the per-app key signs. The domain's verifyingContract is the account itself (the EOA
/// under delegation), so a signature works for one account on one chain. Matches AssayAccount.CALL_TYPEHASH.
export function sponsoredCallTypedData(chainId: number, account: Address, call: SponsoredCall) {
  return {
    domain: { name: "AssayAccount", version: "1", chainId, verifyingContract: account },
    types: {
      Call: [
        { name: "target", type: "address" },
        { name: "data", type: "bytes" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    } as const,
    primaryType: "Call" as const,
    message: { ...call },
  };
}

/// Nonces are unordered in AssayAccount, so a random 128-bit value never needs a chain read.
export function randomNonce(): bigint {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return b.reduce((n, x) => (n << 8n) | BigInt(x), 0n);
}

/// The code an EOA carries while it delegates to `impl` under EIP-7702: 0xef0100 ‖ address.
export const delegationCode = (impl: Address): Hex => `0xef0100${impl.slice(2).toLowerCase()}`;
