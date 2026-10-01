import { createPublicClient, http, type Address } from "viem";
import { monadTestnet } from "viem/chains";

export const CHAIN_ID = 10143;
export const DEFAULT_RPC = "https://testnet-rpc.monad.xyz";
export const RECEIPT_ANCHOR: Address = "0x049A73755cA3508ef3Daa4752A3406f6e00CfB13";
export const VERIFIER_REGISTRY: Address = "0x0C8603041E7d425c4DCa041680C7AF4581dDa9a1";
export const EXPLORER = "https://testnet.monadvision.com";
// In dev and preview, vite proxies /host to the local host (see vite.config.ts).
export const DEFAULT_HOST: string = import.meta.env.VITE_HOST_URL ?? "/host";

export const chainClient = (rpc: string) => createPublicClient({ chain: monadTestnet, transport: http(rpc.trim()) });
