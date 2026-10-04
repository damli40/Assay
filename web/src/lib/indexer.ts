import { receiptAnchorAbi, type ContractReader } from "@assay/receipts";
import { parseAbi, type Address, type Hex } from "viem";
import { CHAIN_ID, INDEXER_URL } from "./config.js";

export interface IndexedCosign {
  kind: "P256" | "K";
  /// P256: keccak256(qx, qy). K: the signer address.
  requester: string;
  block: number;
  txHash: string;
}

export interface AnchorInfo {
  count: number;
  block?: number;
  txHash?: string;
  keyHash?: string;
  /// "indexer": the key that signed this batch. "rpc": the host's key now, which may be newer than the batch.
  source: "indexer" | "rpc";
  agentName?: string;
  /// Only known from the indexer.
  cosigns?: IndexedCosign[];
}

const QUERY = `query Receipt($id: String!, $hash: String!) {
  Anchor(where: { id: { _eq: $id } }) { count block txHash agent { name } hostKey { keyHash } }
  Cosign(where: { receiptHash: { _eq: $hash } }) { kind requester block txHash }
}`;

/// One GraphQL call to Envio for the batch and its co-signs. Null when the indexer doesn't have the batch (yet).
export async function indexedAnchor(agentId: bigint, root: Hex, receiptHash: Hex, url = INDEXER_URL, fetchFn: typeof fetch = fetch, chainId: number = CHAIN_ID): Promise<AnchorInfo | null> {
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { id: `${chainId}-${agentId}-${root.toLowerCase()}`, hash: receiptHash.toLowerCase() } }),
  });
  if (!res.ok) throw new Error(`Indexer: HTTP ${res.status}`);
  const json = (await res.json()) as {
    data?: { Anchor: { count: number; block: number; txHash: string; agent: { name: string | null }; hostKey: { keyHash: string } }[]; Cosign: IndexedCosign[] };
    errors?: { message: string }[];
  };
  if (!json.data) throw new Error(`Indexer: ${json.errors?.[0]?.message ?? "no data"}`);
  const a = json.data.Anchor[0];
  if (!a) return null;
  return { count: a.count, block: a.block, txHash: a.txHash, keyHash: a.hostKey.keyHash, source: "indexer", agentName: a.agent.name ?? undefined, cosigns: json.data.Cosign };
}

const hostKeysAbi = parseAbi(["function hostKeys(uint256) view returns (bytes32 qx, bytes32 qy)", "function keyHashOf(bytes32 qx, bytes32 qy) pure returns (bytes32)"]);

export interface AnchorReader extends ContractReader {
  getTransactionReceipt(args: { hash: Hex }): Promise<{ blockNumber: bigint }>;
}

/// Without the indexer: batch size from `anchors`, block from the anchor tx, and the host's *current* key.
export async function rpcAnchor(client: AnchorReader, anchor: Address, agentId: bigint, root: Hex, anchorTx?: Hex): Promise<AnchorInfo> {
  const [count] = (await client.readContract({ address: anchor, abi: receiptAnchorAbi, functionName: "anchors", args: [agentId, root] })) as [number, bigint];
  const [qx, qy] = (await client.readContract({ address: anchor, abi: hostKeysAbi, functionName: "hostKeys", args: [agentId] })) as [Hex, Hex];
  const keyHash = (await client.readContract({ address: anchor, abi: hostKeysAbi, functionName: "keyHashOf", args: [qx, qy] })) as Hex;
  const block = anchorTx ? Number((await client.getTransactionReceipt({ hash: anchorTx })).blockNumber) : undefined;
  return { count: Number(count), block, txHash: anchorTx, keyHash, source: "rpc" };
}

/// Indexer first (the Envio path); RPC when it fails or hasn't synced the batch.
export async function anchorInfo(opts: { agentId: bigint; root: Hex; receiptHash: Hex; anchorTx?: Hex; client: AnchorReader; anchor: Address; chainId?: number; indexer?: typeof indexedAnchor }): Promise<AnchorInfo> {
  try {
    const found = await (opts.indexer ?? indexedAnchor)(opts.agentId, opts.root, opts.receiptHash, INDEXER_URL, fetch, opts.chainId ?? CHAIN_ID);
    if (found) return found;
  } catch {
    // Fall through to RPC.
  }
  return rpcAnchor(opts.client, opts.anchor, opts.agentId, opts.root, opts.anchorTx);
}

export interface HostProfile {
  agent: {
    agentId: string;
    owner: string | null;
    agentURI: string | null;
    registeredBlock: number | null;
    cardStatus: "OK" | "ERROR" | "UNSUPPORTED" | null;
    name: string | null;
    description: string | null;
    services: { name: string; endpoint: string }[] | null;
    anchorCount: number;
    receiptCount: number;
    cosignCount: number;
    keyCount: number;
    currentKey: { keyHash: string } | null;
  };
  keys: { keyHash: string; setBlock: number; retiredBlock: number | null; active: boolean; anchorCount: number }[];
  rotations: { block: number; txHash: string; toKey: { keyHash: string } }[];
  anchors: { root: string; count: number; cosignCount: number; block: number; txHash: string; hostKey: { keyHash: string } }[];
  activity: { day: string; anchors: number; receipts: number; cosigns: number }[];
  grades: { model: string; verifier: { address: string }; passed: number; total: number; ciLowBps: number; ciHighBps: number; t: string; txHash: string }[];
}

const HOST_QUERY = `query Host($id: String!, $hostKey: String!) {
  Agent(where: { id: { _eq: $id } }) { agentId owner agentURI registeredBlock cardStatus name description services anchorCount receiptCount cosignCount keyCount currentKey { keyHash } }
  HostKey(where: { agent_id: { _eq: $id } }, order_by: { setBlock: desc }) { keyHash setBlock retiredBlock active anchorCount }
  KeyRotation(where: { agent_id: { _eq: $id } }, order_by: { block: desc }) { block txHash toKey { keyHash } }
  Anchor(where: { agent_id: { _eq: $id } }, order_by: { block: desc }, limit: 20) { root count cosignCount block txHash hostKey { keyHash } }
  HostActivity(where: { agent_id: { _eq: $id } }, order_by: { day: desc }, limit: 14) { day anchors receipts cosigns }
  Grade(where: { hostKey: { _eq: $hostKey } }, order_by: { t: desc }) { model verifier { address } passed total ciLowBps ciHighBps t txHash }
}`;

/// Everything the host profile shows, in one GraphQL call. Null when the indexer has no such agent.
export async function hostProfile(agentId: bigint, hostKey: Hex, url = INDEXER_URL, fetchFn: typeof fetch = fetch, chainId: number = CHAIN_ID): Promise<HostProfile | null> {
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: HOST_QUERY, variables: { id: `${chainId}-${agentId}`, hostKey } }),
  });
  if (!res.ok) throw new Error(`Indexer: HTTP ${res.status}`);
  const json = (await res.json()) as { data?: Record<string, unknown[]>; errors?: { message: string }[] };
  if (!json.data) throw new Error(`Indexer: ${json.errors?.[0]?.message ?? "no data"}`);
  const d = json.data;
  if (!d.Agent?.length) return null;
  return {
    agent: d.Agent[0] as HostProfile["agent"],
    keys: d.HostKey as HostProfile["keys"],
    rotations: d.KeyRotation as HostProfile["rotations"],
    anchors: d.Anchor as HostProfile["anchors"],
    activity: d.HostActivity as HostProfile["activity"],
    grades: d.Grade as HostProfile["grades"],
  };
}
