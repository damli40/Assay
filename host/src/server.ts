import { pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import {
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
import { isHex, type Address, type Hex } from "viem";
import { createBatcher, type Batcher } from "./batcher.js";
import { anchorWriteAbi, makeClients, sendTx } from "./chain.js";
import { CHAIN_ID, loadConfig, readJwk } from "./config.js";
import { mountGrades, type GradeDeps } from "./grades.js";
import { Store } from "./store.js";
import { openRouter, providerMatches, providerPin, type Upstream } from "./upstream.js";

export const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
export const COSIGN_LIMIT = 10;
const HOUR = 3_600_000;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

export interface AppDeps {
  signer: HostSigner;
  /// Old public keys kept so receipts they signed still verify (D22).
  retiredJwks?: JWK[];
  store: Store;
  upstream: Upstream;
  model: string;
  provider?: string;
  agentId: bigint;
  anchor: Address;
  publicUrl: string;
  batcher?: Pick<Batcher, "notify">;
  relayCosign: (args: readonly unknown[]) => Promise<Hex>;
  /// Enables GET /v1/grade, read straight from VerifierRegistry.
  grades?: GradeDeps;
  now?: () => number;
}

const fail = (c: Context, status: ContentfulStatusCode, message: string) => c.json({ error: { message } }, status);
const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v: unknown) => (Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : 0);
const publicPart = ({ kty, crv, x, y, kid }: JWK): JWK => ({ kty, crv, x, y, kid, alg: "ES256", use: "sig" });

export function createApp(d: AppDeps): Hono {
  const app = new Hono();
  const now = d.now ?? Date.now;
  const agentIdStr = `erc8004:${CHAIN_ID}:${d.agentId}`;
  const cosignHits = new Map<string, number[]>();

  app.post("/v1/chat/completions", async (c) => {
    const saltHex = c.req.header("x-assay-salt")?.replace(/^0x/, "") ?? "";
    if (!/^[0-9a-fA-F]{64}$/.test(saltHex)) return fail(c, 400, "X-Assay-Salt header is required: 32 random bytes as 64 hex chars");
    const salt = `0x${saltHex.toLowerCase()}` as Hex;

    const cosigner = c.req.header("x-assay-cosigner");
    if (cosigner !== undefined && !BYTES32.test(cosigner)) return fail(c, 400, "X-Assay-Cosigner must be 0x + 64 hex (keccak256(abi.encode(qx, qy)))");

    const req: unknown = await c.req.json().catch(() => undefined);
    if (!isObj(req) || !Array.isArray(req.messages)) return fail(c, 400, "body must be a JSON object with a messages array");
    if (req.stream) return fail(c, 400, "v0 is non-streaming: send stream false or omit it");

    // `provider` is the host's choice, not the client's, so it is neither forwarded nor committed.
    const { messages, model: _model, stream: _stream, provider: _provider, ...params } = req;
    const up = await d.upstream({ ...params, messages, model: d.model, ...providerPin(d.provider) });
    if (up.status !== 200) return c.json(up.json as object, up.status as ContentfulStatusCode);

    const out = isObj(up.json) ? up.json : {};
    if (d.provider && !providerMatches(d.provider, out.provider)) {
      return fail(c, 502, `upstream served by ${JSON.stringify(out.provider)}, not the pinned provider ${d.provider}; no receipt signed`);
    }
    const choice = Array.isArray(out.choices) ? out.choices[0] : undefined;
    const text = choice?.message?.content;
    if (typeof text !== "string") return fail(c, 502, "upstream returned no assistant text; no receipt signed");

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
      registrations: [{ agentId: Number(d.agentId), agentRegistry: `eip155:${CHAIN_ID}:${IDENTITY_REGISTRY}` }],
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
        chainId: CHAIN_ID,
        contract: d.anchor,
        function: sig,
        args: [d.agentId.toString(), hash, proof, batch.root],
        cast: `cast call ${d.anchor} "${sig}(bool)" ${d.agentId} ${hash} "[${proof.join(",")}]" ${batch.root} --rpc-url https://testnet-rpc.monad.xyz`,
      },
    });
  });

  app.post("/v1/cosign", async (c) => {
    // In-memory and per process: resets on restart. Enough for one host instance.
    const ip = getConnInfo(c).remote.address ?? "unknown";
    const t = now();
    const hits = (cosignHits.get(ip) ?? []).filter((h) => t - h < HOUR);
    if (hits.length >= COSIGN_LIMIT) return fail(c, 429, `co-sign relay is limited to ${COSIGN_LIMIT} per hour per IP`);
    cosignHits.set(ip, [...hits, t]);

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

  app.get("/health", (c) => c.json({ ok: true, model: d.model, kid: d.signer.kid, pending: d.store.pending().length }));
  if (d.grades) mountGrades(app, d.grades);

  return app;
}

async function main() {
  const cfg = loadConfig();
  const jwk = await readJwk(cfg.hostJwkPath);
  const signer = await createHostSigner(jwk, jwk.kid);
  const retiredJwks = await Promise.all(cfg.retiredJwkPaths.map(readJwk));
  const store = new Store(cfg.dataDir);
  const { clients, relayer } = makeClients(cfg.rpcUrls, cfg.relayerPrivateKey);
  const batcher = createBatcher({
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
    signer,
    retiredJwks,
    store,
    upstream: openRouter(cfg.openrouterApiKey),
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
