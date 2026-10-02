import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { calculateJwkThumbprint, type JWK } from "jose";
import { isAddress, type Address, type Hex } from "viem";

export const CHAIN_ID = 10143;
export const DEFAULT_VERIFIER_REGISTRY = "0x7755818dc08659D2A3A66FA3ddb1Ce636c145C91";
const HOST_DIR = fileURLToPath(new URL("..", import.meta.url));

export interface Config {
  openrouterApiKey: string;
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
  const get = (name: string) => env[name]?.trim() || undefined;
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

  const openrouterApiKey = required("OPENROUTER_API_KEY");
  const upstreamModel = required("UPSTREAM_MODEL");
  const rpc1 = required("MONAD_RPC_URL");
  const rpc2 = get("MONAD_RPC_URL_2");
  for (const [name, url] of [["MONAD_RPC_URL", rpc1], ["MONAD_RPC_URL_2", rpc2]] as const) {
    if (url && !/^https?:\/\//.test(url)) errors.push(`${name} must be an http(s) URL`);
  }

  const anchorAddress = required("ANCHOR_ADDRESS");
  if (anchorAddress && !isAddress(anchorAddress)) errors.push("ANCHOR_ADDRESS must be a 0x address");

  const verifierRegistry = get("VERIFIER_REGISTRY") ?? DEFAULT_VERIFIER_REGISTRY;
  if (!isAddress(verifierRegistry)) errors.push("VERIFIER_REGISTRY must be a 0x address");

  const agentRaw = required("HOST_AGENT_ID");
  if (agentRaw && !/^[1-9]\d*$/.test(agentRaw)) errors.push("HOST_AGENT_ID must be a positive integer (the ERC-8004 agentId)");

  const relayerPrivateKey = required("RELAYER_PRIVATE_KEY");
  if (relayerPrivateKey && !/^0x[0-9a-fA-F]{64}$/.test(relayerPrivateKey)) errors.push("RELAYER_PRIVATE_KEY must be 0x + 64 hex");

  const port = int("PORT", 8787, 1);
  const cfg: Config = {
    openrouterApiKey,
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
