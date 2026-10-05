import type { Address } from "viem";

export interface ChainConfig {
  name: string;
  /// Short label for the network switch.
  short: string;
  /// The Assay host serving this chain, same-origin (Vercel rewrites it; Vite proxies it in dev).
  host: string;
  rpc: string;
  explorer: string;
  receiptAnchor: Address;
  verifierRegistry: Address;
  creAttestor: Address;
  identityRegistry: Address;
}

/// Every chain Assay is deployed on. A receipt names its chain in host.agentId (erc8004:<chainId>:<id>).
export const CHAINS: Record<number, ChainConfig> = {
  10143: {
    name: "Monad testnet",
    short: "Testnet",
    host: import.meta.env.VITE_HOST_URL ?? "/host",
    rpc: "https://testnet-rpc.monad.xyz",
    explorer: "https://testnet.monadvision.com",
    receiptAnchor: "0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24",
    verifierRegistry: "0x7755818dc08659D2A3A66FA3ddb1Ce636c145C91",
    creAttestor: "0xB4A1CB9e40aDa44570Ae790430C23876d460deDC",
    identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  },
};

const NETWORK_KEY = "assay.chain";
const FALLBACK_CHAIN = 10143;

/// The network the reader picked in the top bar, remembered in this browser. Public setting, not a secret.
export function selectedChainId(): number {
  try {
    const id = Number(localStorage.getItem(NETWORK_KEY));
    if (CHAINS[id]) return id;
  } catch {
    // No storage (tests, private mode): use the default.
  }
  return FALLBACK_CHAIN;
}

export function setSelectedChainId(id: number) {
  try {
    localStorage.setItem(NETWORK_KEY, String(id));
  } catch {
    // Not remembered; the page still switches for this load.
  }
}

/// The chain the app defaults to: forms, Ask, host profiles without ?chain=. Receipts use their own chain.
export const CHAIN_ID = selectedChainId();

export function chainConfig(chainId: number = CHAIN_ID): ChainConfig {
  const c = CHAINS[chainId];
  if (!c) throw new Error(`This app doesn't know chain ${chainId}.`);
  return c;
}

/// "erc8004:143:7" → 143. Undefined when the string isn't an ERC-8004 agent id.
export function chainOfAgentId(agentId: string): number | undefined {
  const m = /^erc8004:(\d+):\d+$/.exec(agentId);
  return m ? Number(m[1]) : undefined;
}

// The default chain's values, for views that work on one chain at a time.
const primary = chainConfig();
export const DEFAULT_RPC = primary.rpc;
export const RECEIPT_ANCHOR = primary.receiptAnchor;
export const VERIFIER_REGISTRY = primary.verifierRegistry;
export const CRE_ATTESTOR = primary.creAttestor;
export const IDENTITY_REGISTRY = primary.identityRegistry;
export const EXPLORER = primary.explorer;
export const DEFAULT_HOST = primary.host;

export const DOCS_URL = "https://assay.gitbook.io/assay-docs";
export const GITHUB_URL = "https://github.com/trudransh/Assay";
// Envio Cloud GraphQL, one endpoint for every chain (ids are chain-prefixed). Public and read-only,
// so it is safe in the bundle; never put a token in a VITE_ variable.
export const INDEXER_URL: string = import.meta.env.VITE_INDEXER_URL ?? "https://indexer.dev.hyperindex.xyz/7c1753d/v1/graphql";
