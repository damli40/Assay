import { createPublicClient, http, type Address } from "viem";
import { monadTestnet } from "viem/chains";

export const CHAIN_ID = 10143;
export const DEFAULT_RPC = "https://testnet-rpc.monad.xyz";
export const RECEIPT_ANCHOR: Address = "0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24";
export const VERIFIER_REGISTRY: Address = "0x7755818dc08659D2A3A66FA3ddb1Ce636c145C91";
export const EXPLORER = "https://testnet.monadvision.com";
// In dev and preview, vite proxies /host to the local host (see vite.config.ts).
export const DEFAULT_HOST: string = import.meta.env.VITE_HOST_URL ?? "/host";

export const chainClient = (rpc: string) => createPublicClient({ chain: monadTestnet, transport: http(rpc.trim()) });
