import { createPublicClient, http } from "viem";

// Reads only (eth_call, receipts), so no chain object is needed: the RPC decides the chain.
export const chainClient = (rpc: string) => createPublicClient({ transport: http(rpc.trim()) });
