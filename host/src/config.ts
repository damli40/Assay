import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { calculateJwkThumbprint, type JWK } from "jose";
import { isAddress, type Address, type Hex } from "viem";
import { OPENROUTER_URL } from "./upstream.js";

/// Testnet's chain id, kept as the default for tests and older callers.
export const CHAIN_ID = 10143;

/// Per-network constants. ASSAY_NETWORK picks one; each host process serves exactly one chain.
export const NETWORKS = {
  testnet: {
    chainId: 10143,
    name: "Monad Testnet",
    publicRpc: "https://testnet-rpc.monad.xyz",
    identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    verifierRegistry: "0x7755818dc08659D2A3A66FA3ddb1Ce636c145C91",
  },
  mainnet: {
    chainId: 143,
    name: "Monad",
    publicRpc: "https://rpc.monad.xyz",
    identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    verifierRegistry: undefined,
  },
} as const satisfies Record<string, { chainId: number; name: string; publicRpc: string; identityRegistry: string; verifierRegistry: string | undefined }>;
export type Network = keyof typeof NETWORKS;
export const DEFAULT_VERIFIER_REGISTRY = NETWORKS.testnet.verifierRegistry;
const HOST_DIR = fileURLToPath(new URL("..", import.meta.url));

export interface Config {
  network: Network;
  chainId: number;
  identityRegistry: Address;
  openrouterApiKey: string;
  /// Full chat-completions URL. OpenRouter unless set, e.g. a lab's own OpenAI-compatible API.
  upstreamUrl: string;
  upstreamModel: string;
  upstreamProvider?: string;
  rpcUrls: string[];
  anchorAddress: Address;
  verifierRegistry: Address;
  hostAgentId: bigint;
  relayerPrivateKey: Hex;
  hostJwkPath: string;
  retiredJwkPaths: string[];
  dataDir: string;
  publicUrl: string;
  batchSeconds: number;
  batchMax: number;
  port: number;
}

/// Reads every variable and reports all problems at once. Values are never echoed, since some are secrets.
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const errors: string[] = [];
  const networkRaw = env.ASSAY_NETWORK?.trim() || "testnet";
  if (!(networkRaw in NETWORKS)) errors.push("ASSAY_NETWORK must be testnet or mainnet");
  const network = (networkRaw in NETWORKS ? networkRaw : "testnet") as Network;
  const net = NETWORKS[network];
  // NAME_MAINNET / NAME_TESTNET wins over NAME, so one .env can hold both networks.
  const suffix = `_${network.toUpperCase()}`;
  const get = (name: string) => env[`${name}${suffix}`]?.trim() || env[name]?.trim() || undefined;
  const required = (name: string) => {
    const v = get(name);
    if (!v) errors.push(`${name} is required`);
    return v ?? "";
  };
  const int = (name: string, dflt: number, min: number) => {
    const raw = get(name);
    if (raw === undefined) return dflt;
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n < min) errors.push(`${name} must be an integer >= ${min}`);
    return n;
  };

  const upstreamUrl = get("UPSTREAM_URL");
  if (upstreamUrl && !/^https:\/\//.test(upstreamUrl)) errors.push("UPSTREAM_URL must be an https URL");
  // A direct upstream uses its own key; provider pinning only exists on OpenRouter.
  const openrouterApiKey = upstreamUrl ? required("UPSTREAM_API_KEY") : required("OPENROUTER_API_KEY");
  if (upstreamUrl && get("UPSTREAM_PROVIDER")) errors.push("UPSTREAM_PROVIDER only applies to OpenRouter; leave it empty with UPSTREAM_URL");
  const upstreamModel = required("UPSTREAM_MODEL");
  const rpc1 = required("MONAD_RPC_URL");
  // The public RPC is the fallback when no second RPC is set.
  const rpc2 = get("MONAD_RPC_URL_2") ?? (rpc1 === net.publicRpc ? undefined : net.publicRpc);
  for (const [name, url] of [["MONAD_RPC_URL", rpc1], ["MONAD_RPC_URL_2", rpc2]] as const) {
    if (url && !/^https?:\/\//.test(url)) errors.push(`${name} must be an http(s) URL`);
  }

  const anchorAddress = required("ANCHOR_ADDRESS");
  if (anchorAddress && !isAddress(anchorAddress)) errors.push("ANCHOR_ADDRESS must be a 0x address");

  const verifierRegistry = get("VERIFIER_REGISTRY") ?? net.verifierRegistry ?? "";
  if (!isAddress(verifierRegistry)) errors.push(`VERIFIER_REGISTRY${suffix} must be a 0x address`);

  const agentRaw = required("HOST_AGENT_ID");
  if (agentRaw && !/^[1-9]\d*$/.test(agentRaw)) errors.push("HOST_AGENT_ID must be a positive integer (the ERC-8004 agentId)");

  const relayerPrivateKey = required("RELAYER_PRIVATE_KEY");
  if (relayerPrivateKey && !/^0x[0-9a-fA-F]{64}$/.test(relayerPrivateKey)) errors.push("RELAYER_PRIVATE_KEY must be 0x + 64 hex");

  const port = int("PORT", 8787, 1);
  const cfg: Config = {
    network,
    chainId: net.chainId,
    identityRegistry: net.identityRegistry as Address,
    openrouterApiKey,
    upstreamUrl: upstreamUrl ?? OPENROUTER_URL,
    upstreamModel,
    upstreamProvider: get("UPSTREAM_PROVIDER"),
    rpcUrls: rpc2 ? [rpc1, rpc2] : [rpc1],
    anchorAddress: anchorAddress as Address,
    verifierRegistry: verifierRegistry as Address,
    hostAgentId: agentRaw && /^[1-9]\d*$/.test(agentRaw) ? BigInt(agentRaw) : 0n,
    relayerPrivateKey: relayerPrivateKey as Hex,
    hostJwkPath: resolve(HOST_DIR, get("HOST_JWK_PATH") ?? ".keys/host.jwk.json"),
    retiredJwkPaths: (get("RETIRED_JWK_PATHS") ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => resolve(HOST_DIR, p)),
    dataDir: resolve(HOST_DIR, get("DATA_DIR") ?? "data"),
    publicUrl: (get("PUBLIC_URL") ?? `http://localhost:${port}`).replace(/\/$/, ""),
    batchSeconds: int("BATCH_SECONDS", 300, 1),
    batchMax: int("BATCH_MAX", 64, 1),
    port,
  };
  if (errors.length) throw new Error(`host config:\n  - ${errors.join("\n  - ")}`);
  return cfg;
}

/// Loads a JWK file and fills in `kid` (RFC 7638 thumbprint) when the file has none.
export async function readJwk(path: string): Promise<JWK & { kid: string }> {
  let jwk: JWK;
  try {
    jwk = JSON.parse(readFileSync(path, "utf8")) as JWK;
  } catch (e) {
    throw new Error(`cannot read JWK at ${path} (run scripts/keygen.ts first?): ${(e as Error).message}`);
  }
  if (jwk.kty !== "EC" || jwk.crv !== "P-256") throw new Error(`${path} is not a P-256 JWK`);
  return { ...jwk, kid: jwk.kid ?? (await calculateJwkThumbprint(jwk)) };
}
