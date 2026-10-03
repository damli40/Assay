import { createPublicClient, http, type Address } from "viem";
import { monadTestnet } from "viem/chains";

export const CHAIN_ID = 10143;
export const DEFAULT_RPC = "https://testnet-rpc.monad.xyz";
export const RECEIPT_ANCHOR: Address = "0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24";
export const VERIFIER_REGISTRY: Address = "0x7755818dc08659D2A3A66FA3ddb1Ce636c145C91";
export const CRE_ATTESTOR: Address = "0xB4A1CB9e40aDa44570Ae790430C23876d460deDC";
export const IDENTITY_REGISTRY: Address = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
export const EXPLORER = "https://testnet.monadvision.com";
export const DOCS_URL = "https://assay.gitbook.io/assay-docs";
export const GITHUB_URL = "https://github.com/trudransh/Assay";
// In dev and preview, vite proxies /host to the local host (see vite.config.ts).
export const DEFAULT_HOST: string = import.meta.env.VITE_HOST_URL ?? "/host";
// Envio Cloud GraphQL. Public and read-only, so it is safe in the bundle; never put a token in a VITE_ variable.
export const INDEXER_URL: string = import.meta.env.VITE_INDEXER_URL ?? "https://indexer.dev.hyperindex.xyz/7c1753d/v1/graphql";

export const chainClient = (rpc: string) => createPublicClient({ chain: monadTestnet, transport: http(rpc.trim()) });
