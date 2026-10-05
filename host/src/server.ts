import { pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import {
  assistantOutput,
  buildReceipt,
  commitRequest,
  commitResponse,
  createHostSigner,
  receiptHash,
  type ContractReader,
  type HostSigner,
} from "@assay/receipts";
import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { JWK } from "jose";
import { createPublicClient, http, isHex, type Address, type Hex } from "viem";
import { createBatcher, type Batcher } from "./batcher.js";
import { anchorWriteAbi, makeClients, sendTx } from "./chain.js";
import { CHAIN_ID, loadConfig, NETWORKS, readJwk } from "./config.js";
import { mountGrades, type GradeDeps } from "./grades.js";
import { Store } from "./store.js";
import { openRouter, providerMatches, providerPin, type Upstream } from "./upstream.js";

export const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
export const COSIGN_LIMIT = 10;
/// Chat requests per client per hour, and for the whole host per hour. Every receipt eventually costs an anchor.
export const CHAT_LIMIT = 120;
export const CHAT_LIMIT_GLOBAL = 1200;
const HOUR = 3_600_000;

/// The client behind the proxies. Caddy (same machine) and Vercel forward it; directly connected callers are taken as-is.
/// Forwarded headers can be forged by anyone calling the VM directly, so the global limit is the hard bound.
function clientIp(c: Context): string {
  let remote = "unknown";
  try {
    remote = getConnInfo(c).remote.address ?? "unknown";
  } catch {
    // No socket (in-process requests, tests): fall back to the forwarded headers below.
  }
  if (remote !== "unknown" && !/^(127\.|::1$|::ffff:127\.)/.test(remote)) return remote;
  return c.req.header("x-real-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? remote;
}

/// Sliding one-hour window. In memory, per process: resets on restart, enough for one host instance.
function overLimit(hits: Map<string, number[]>, key: string, limit: number, t: number): boolean {
  const recent = (hits.get(key) ?? []).filter((h) => t - h < HOUR);
  if (recent.length >= limit) return true;
  hits.set(key, [...recent, t]);
  return false;
}
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

export interface AppDeps {
  signer: HostSigner;
  /// The chain this host anchors on (named in every receipt). Default: testnet.
  chainId?: number;
  identityRegistry?: Address;
  /// Chat requests per client and per host per hour. Defaults: CHAT_LIMIT and CHAT_LIMIT_GLOBAL.
  chatLimit?: number;
  chatLimitGlobal?: number;
  /// RPC printed in the reproduce line. Default: testnet's public RPC.
  publicRpc?: string;
  /// Old public keys kept so receipts they signed still verify (D22).
  retiredJwks?: JWK[];
  store: Store;
  upstream: Upstream;
  model: string;
  provider?: string;
  agentId: bigint;
  anchor: Address;
  publicUrl: string;
  /// `schedule` adds batchSeconds and nextBatchInMs to /health, so the web app can count down to the batch.
  batcher?: Pick<Batcher, "notify"> & Partial<Pick<Batcher, "schedule">>;
  relayCosign: (args: readonly unknown[]) => Promise<Hex>;
  /// Enables GET /v1/grade, read straight from VerifierRegistry.
  grades?: GradeDeps;
  now?: () => number;
}

const fail = (c: Context, status: ContentfulStatusCode, message: string) => c.json({ error: { message } }, status);
const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v: unknown) => (Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : 0);
const publicPart = ({ kty, crv, x, y, kid }: JWK): JWK => ({ kty, crv, x, y, kid, alg: "ES256", use: "sig" });

/// Used when a request sets neither max_tokens nor max_completion_tokens.
export const DEFAULT_MAX_TOKENS = 1024;

export function createApp(d: AppDeps): Hono {
  const app = new Hono();
  const now = d.now ?? Date.now;
  const chainId = d.chainId ?? CHAIN_ID;
  const agentIdStr = `erc8004:${chainId}:${d.agentId}`;
  const cosignHits = new Map<string, number[]>();

  const chatHits = new Map<string, number[]>();
  app.post("/v1/chat/completions", async (c) => {
    const t0 = now();
    // Per client first, so a request it rejects doesn't use up the host-wide budget.
    if (overLimit(chatHits, clientIp(c), d.chatLimit ?? CHAT_LIMIT, t0)) return fail(c, 429, `requests are limited to ${d.chatLimit ?? CHAT_LIMIT} per hour per client`);
    if (overLimit(chatHits, "*", d.chatLimitGlobal ?? CHAT_LIMIT_GLOBAL, t0)) return fail(c, 429, "this host is at its hourly request limit; try again later");
    const saltHex = c.req.header("x-assay-salt")?.replace(/^0x/, "") ?? "";
    if (!/^[0-9a-fA-F]{64}$/.test(saltHex)) return fail(c, 400, "X-Assay-Salt header is required: 32 random bytes as 64 hex chars");
    const salt = `0x${saltHex.toLowerCase()}` as Hex;

    const cosigner = c.req.header("x-assay-cosigner");
    if (cosigner !== undefined && !BYTES32.test(cosigner)) return fail(c, 400, "X-Assay-Cosigner must be 0x + 64 hex (keccak256(abi.encode(qx, qy)))");

    const req: unknown = await c.req.json().catch(() => undefined);
    if (!isObj(req) || !Array.isArray(req.messages)) return fail(c, 400, "body must be a JSON object with a messages array");
    if (req.stream) return fail(c, 400, "v0 is non-streaming: send stream false or omit it");

    // `provider` is the host's choice, not the client's, so it is neither forwarded nor committed.
    const { messages, model: _model, stream: _stream, provider: _provider, ...rest } = req;
    // Some upstreams (Google's Gemma endpoint) return 500 without a token budget, so fill one in.
    // The filled value is what is forwarded, committed and signed, so the receipt matches the call.
    const params = rest.max_tokens === undefined && rest.max_completion_tokens === undefined ? { ...rest, max_tokens: DEFAULT_MAX_TOKENS } : rest;
    const up = await d.upstream({ ...params, messages, model: d.model, ...providerPin(d.provider) });
    if (up.status !== 200) return c.json(up.json as object, up.status as ContentfulStatusCode);

    const out = isObj(up.json) ? up.json : {};
    if (d.provider && !providerMatches(d.provider, out.provider)) {
      return fail(c, 502, `upstream served by ${JSON.stringify(out.provider)}, not the pinned provider ${d.provider}; no receipt signed`);
    }
    const choice = Array.isArray(out.choices) ? out.choices[0] : undefined;
    // Text, or the JCS of tool_calls for a tool-only answer (SPEC §1): the same rule wrap() checks.
    const text = assistantOutput(choice?.message);
    if (text === undefined) return fail(c, 502, "upstream returned neither assistant text nor tool calls; no receipt signed");

    const body = buildReceipt({
      model: d.model,
      host: { agentId: agentIdStr, keyId: d.signer.kid, alg: "ES256" },
      req: { commit: commitRequest(salt, messages, params), params, ...(cosigner ? { cosigner: cosigner.toLowerCase() as Hex } : {}) },
      res: {
        commit: commitResponse(salt, text),
        tokensIn: count(out.usage?.prompt_tokens),
        tokensOut: count(out.usage?.completion_tokens),
        finish: typeof choice.finish_reason === "string" ? choice.finish_reason : "unknown",
      },
    });
    const jws = await d.signer.signReceipt(body);
    const hash = receiptHash(body);
    d.store.addReceipt({ hash, body, jws });
    d.batcher?.notify();

    c.header("X-Assay-Receipt", Buffer.from(JSON.stringify({ body, jws })).toString("base64url"));
    c.header("X-Assay-Receipt-Hash", hash);
    return c.json(out);
  });

  app.get("/.well-known/jwks.json", (c) =>
    c.json({
      keys: [publicPart(d.signer.publicJwk), ...(d.retiredJwks ?? []).map((k) => ({ ...publicPart(k), status: "retired" }))],
    }),
  );

  app.get("/.well-known/agent-registration.json", (c) =>
    c.json({
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: "Assay reference host",
      description: "OpenAI-compatible proxy that signs an Assay receipt for every response and anchors receipt batches on Monad.",
      services: [
        { name: "chat", endpoint: `${d.publicUrl}/v1/chat/completions` },
        { name: "jwks", endpoint: `${d.publicUrl}/.well-known/jwks.json` },
        { name: "receipts", endpoint: `${d.publicUrl}/v1/receipts/{receiptHash}` },
      ],
      registrations: [{ agentId: Number(d.agentId), agentRegistry: `eip155:${chainId}:${d.identityRegistry ?? IDENTITY_REGISTRY}` }],
      supportedTrust: [],
    }),
  );

  app.get("/v1/receipts/:hash", (c) => {
    const hash = c.req.param("hash").toLowerCase() as Hex;
    if (!BYTES32.test(hash)) return fail(c, 400, "receipt hash must be 0x + 64 hex");
    const rec = d.store.getReceipt(hash);
    if (!rec) return fail(c, 404, "unknown receipt");
    const batch = d.store.getBatch(hash);
    if (!batch) return c.json({ status: "pending" });
    const proof = batch.proofs[hash];
    const sig = "verifyReceipt(uint256,bytes32,bytes32[],bytes32)";
    return c.json({
      status: "anchored",
      body: rec.body,
      jws: rec.jws,
      root: batch.root,
      proof,
      anchorTx: batch.anchorTx,
      reproduce: {
        chainId,
        contract: d.anchor,
        function: sig,
        args: [d.agentId.toString(), hash, proof, batch.root],
        cast: `cast call ${d.anchor} "${sig}(bool)" ${d.agentId} ${hash} "[${proof.join(",")}]" ${batch.root} --rpc-url ${d.publicRpc ?? NETWORKS.testnet.publicRpc}`,
      },
    });
  });

  app.post("/v1/cosign", async (c) => {
    if (overLimit(cosignHits, clientIp(c), COSIGN_LIMIT, now())) return fail(c, 429, `co-sign relay is limited to ${COSIGN_LIMIT} per hour per IP`);

    const b: unknown = await c.req.json().catch(() => undefined);
    const a = isObj(b) && isObj(b.auth) ? b.auth : undefined;
    const index = (v: unknown) => (typeof v === "number" || typeof v === "string") && /^\d+$/.test(String(v));
    if (
      !isObj(b) ||
      !a ||
      ![b.receiptHash, b.qx, b.qy, a.r, a.s].every((v) => typeof v === "string" && BYTES32.test(v)) ||
      !index(a.challengeIndex) ||
      !index(a.typeIndex) ||
      !(typeof a.authenticatorData === "string" && isHex(a.authenticatorData)) ||
      typeof a.clientDataJSON !== "string"
    ) {
      return fail(c, 400, "body must be {receiptHash, qx, qy, auth: {r, s, challengeIndex, typeIndex, authenticatorData, clientDataJSON}}");
    }

    const hash = (b.receiptHash as string).toLowerCase() as Hex;
    if (!d.store.getReceipt(hash)) return fail(c, 404, "unknown receipt: this host only relays co-signs for receipts it issued");
    const batch = d.store.getBatch(hash);
    if (!batch) return fail(c, 409, "receipt is not anchored yet; retry after the next batch");

    const auth = {
      r: a.r,
      s: a.s,
      challengeIndex: BigInt(a.challengeIndex),
      typeIndex: BigInt(a.typeIndex),
      authenticatorData: a.authenticatorData,
      clientDataJSON: a.clientDataJSON,
    };
    try {
      const txHash = await d.relayCosign([d.agentId, hash, batch.proofs[hash], batch.root, auth, b.qx, b.qy]);
      return c.json({ txHash });
    } catch (e) {
      return fail(c, 502, `co-sign relay failed: ${(e as Error).message}`);
    }
  });

  app.get("/health", (c) => c.json({ ok: true, model: d.model, kid: d.signer.kid, pending: d.store.pending().length, ...d.batcher?.schedule?.() }));
  if (d.grades) mountGrades(app, d.grades);

  return app;
}

async function main() {
  const cfg = loadConfig();
  const jwk = await readJwk(cfg.hostJwkPath);
  const signer = await createHostSigner(jwk, jwk.kid);
  const retiredJwks = await Promise.all(cfg.retiredJwkPaths.map(readJwk));
  const store = new Store(cfg.dataDir);
  const { clients, relayer } = makeClients(cfg.rpcUrls, cfg.relayerPrivateKey, cfg.network);
  const batcher = createBatcher({
    chainId: cfg.chainId,
    store,
    signer,
    clients,
    anchor: cfg.anchorAddress,
    agentId: cfg.hostAgentId,
    relayer,
    batchSeconds: cfg.batchSeconds,
    batchMax: cfg.batchMax,
  });
  const app = createApp({
    chainId: cfg.chainId,
    identityRegistry: cfg.identityRegistry,
    publicRpc: NETWORKS[cfg.network].publicRpc,
    signer,
    retiredJwks,
    store,
    upstream: openRouter(cfg.openrouterApiKey, fetch, cfg.upstreamUrl),
    model: cfg.upstreamModel,
    provider: cfg.upstreamProvider,
    agentId: cfg.hostAgentId,
    anchor: cfg.anchorAddress,
    publicUrl: cfg.publicUrl,
    batcher,
    relayCosign: (args) => sendTx(clients, { address: cfg.anchorAddress, abi: anchorWriteAbi, functionName: "cosign", args }),
    // The wallet clients extend publicActions, so they can read contracts too.
    grades: { reader: clients[0] as unknown as ContractReader, registry: cfg.verifierRegistry },
  });

  // Refuse to start on the wrong chain: a mainnet host pointed at a testnet RPC would sign anchors nobody can verify.
  for (const url of cfg.rpcUrls) {
    const got = await createPublicClient({ transport: http(url) }).getChainId();
    if (got !== cfg.chainId) throw new Error(`RPC ${new URL(url).host} is chain ${got}, but ASSAY_NETWORK=${cfg.network} needs ${cfg.chainId}`);
  }
  await batcher.checkBalance();
  batcher.start();
  serve({ fetch: app.fetch, port: cfg.port }, () =>
    console.info(`[host] ${cfg.upstreamModel} on :${cfg.port}, kid ${signer.kid}, ${store.pending().length} receipts pending`),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
}
