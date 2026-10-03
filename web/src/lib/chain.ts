import { createPublicClient, http } from "viem";
import { monadTestnet } from "viem/chains";

export const chainClient = (rpc: string) => createPublicClient({ chain: monadTestnet, transport: http(rpc.trim()) });
