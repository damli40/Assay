import { createWalletClient, defineChain, http, parseAbi, publicActions, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { NETWORKS, type Network } from "./config.js";

export const monadChain = (network: Network) =>
  defineChain({
    id: NETWORKS[network].chainId,
    name: NETWORKS[network].name,
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [NETWORKS[network].publicRpc] } },
  });

export const monadTestnet = monadChain("testnet");

export const anchorWriteAbi = parseAbi([
  "function anchor(uint256 agentId, bytes32 root, uint32 count, bytes32 r, bytes32 s)",
  "function cosign(uint256 agentId, bytes32 receiptHash, bytes32[] proof, bytes32 root, (bytes32 r, bytes32 s, uint256 challengeIndex, uint256 typeIndex, bytes authenticatorData, string clientDataJSON) auth, bytes32 qx, bytes32 qy)",
  "function verifyReceipt(uint256 agentId, bytes32 receiptHash, bytes32[] proof, bytes32 root) view returns (bool)",
]);

export interface WriteRequest {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
}

/// The subset of a viem wallet+public client the host uses, so tests can pass a plain object.
export interface ChainClient {
  estimateContractGas(req: WriteRequest): Promise<bigint>;
  writeContract(req: WriteRequest & { gas: bigint }): Promise<Hex>;
  waitForTransactionReceipt(args: { hash: Hex }): Promise<{ status: "success" | "reverted" }>;
  getBalance(args: { address: Address }): Promise<bigint>;
}

export class TxRevertedError extends Error {
  constructor(readonly hash: Hex) {
    super(`transaction ${hash} reverted`);
  }
}

/// One client per RPC URL, in order: primary first, then the fallback.
export function makeClients(rpcUrls: string[], relayerPrivateKey: Hex, network: Network = "testnet"): { clients: ChainClient[]; relayer: Address } {
  const account = privateKeyToAccount(relayerPrivateKey);
  const chain = monadChain(network);
  const clients = rpcUrls.map(
    (url) => createWalletClient({ account, chain, transport: http(url) }).extend(publicActions) as unknown as ChainClient,
  );
  return { clients, relayer: account.address };
}

/// Estimate, send with gas = estimate * 1.2 (Monad bills the limit), wait, and require status success.
/// Any RPC error moves on to the next client once; a revert does not, since it already paid gas and would revert again.
export async function sendTx(clients: ChainClient[], req: WriteRequest, log: Pick<Console, "warn"> = console): Promise<Hex> {
  let lastError: unknown;
  for (const [i, c] of clients.entries()) {
    try {
      const gas = ((await c.estimateContractGas(req)) * 12n) / 10n;
      const hash = await c.writeContract({ ...req, gas });
      const receipt = await c.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new TxRevertedError(hash);
      return hash;
    } catch (e) {
      if (e instanceof TxRevertedError) throw e;
      lastError = e;
      if (i < clients.length - 1) log.warn(`[chain] ${req.functionName} failed on RPC ${i + 1}, retrying on RPC ${i + 2}: ${(e as Error).message}`);
    }
  }
  throw lastError;
}
