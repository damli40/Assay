// End-to-end run of the whole stack on a local chain: real contracts, real host (store, signer, batcher,
// routes), SDK on the client side, a real P-256 passkey co-signature. Only the model is a stub.
//
//   anvil --chain-id 10143 --port 8548 &
//   (cd contracts && forge build)
//   corepack pnpm --filter @assay/host exec tsx scripts/e2e-local.ts
import { createHash, generateKeyPairSync, sign as signDer } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import {
  assertionToWebAuthnAuth,
  createHostSigner,
  requesterKeyHash,
  verifyReceipt,
  wrap,
} from "@assay/receipts";
import type { JWK } from "jose";
import { createPublicClient, createWalletClient, http, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createBatcher } from "../src/batcher.js";
import { anchorWriteAbi, makeClients, monadTestnet, sendTx } from "../src/chain.js";
import { createApp } from "../src/server.js";
import { Store } from "../src/store.js";

const RPC = process.env.E2E_RPC ?? "http://127.0.0.1:8548";
const PORT = Number(process.env.E2E_PORT ?? 8799);
// Anvil's first dev account. Local chain only.
const DEV_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const OUT = fileURLToPath(new URL("../../contracts/out/", import.meta.url));

const artifact = (file: string, name: string) => {
  const j = JSON.parse(readFileSync(join(OUT, file, `${name}.json`), "utf8"));
  return { abi: j.abi as Abi, bytecode: j.bytecode.object as Hex };
};

const results: [string, boolean, string?][] = [];
const check = (name: string, ok: boolean, detail?: string) => {
  results.push([name, ok, detail]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

const account = privateKeyToAccount(DEV_KEY);
const wallet = createWalletClient({ account, chain: monadTestnet, transport: http(RPC) });
const pub = createPublicClient({ chain: monadTestnet, transport: http(RPC) });
if ((await pub.getChainId()) !== 10143) throw new Error("start anvil with --chain-id 10143");

async function deploy(file: string, name: string, args: unknown[] = []): Promise<Address> {
  const { abi, bytecode } = artifact(file, name);
  const hash = await wallet.deployContract({ abi, bytecode, args });
  const r = await pub.waitForTransactionReceipt({ hash });
  return r.contractAddress!;
}
async function write(address: Address, file: string, name: string, functionName: string, args: unknown[]) {
  const hash = await wallet.writeContract({ address, abi: artifact(file, name).abi, functionName, args });
  await pub.waitForTransactionReceipt({ hash });
}

// 1. Contracts: identity registry stand-in, then ReceiptAnchor with user verification required.
const registry = await deploy("MockIdentityRegistry.sol", "MockIdentityRegistry");
await write(registry, "MockIdentityRegistry.sol", "MockIdentityRegistry", "register", [""]);
const agentId = 1n;
const anchor = await deploy("ReceiptAnchor.sol", "ReceiptAnchor", [registry, true]);
check("contracts deployed", true, `ReceiptAnchor ${anchor}`);

// 2. Host key: a fresh ES256 key registered as agent 1's signing key.
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
const jwk = { ...((await crypto.subtle.exportKey("jwk", pair.privateKey)) as JWK), kid: "e2e-key" };
const signer = await createHostSigner(jwk, "e2e-key");
const b64 = (s: string) => `0x${Buffer.from(s, "base64url").toString("hex")}` as Hex;
await write(anchor, "ReceiptAnchor.sol", "ReceiptAnchor", "setHostKey", [agentId, b64(jwk.x!), b64(jwk.y!)]);

// 3. Host: real store, batcher and routes; the model is a stub that always answers "OK".
const store = new Store(mkdtempSync(join(tmpdir(), "assay-e2e-")));
const { clients, relayer } = makeClients([RPC], DEV_KEY);
const batcher = createBatcher({ store, signer, clients, anchor, agentId, relayer, batchSeconds: 3600, batchMax: 64 });
const app = createApp({
  signer,
  store,
  upstream: async () => ({
    status: 200,
    json: { choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 9, completion_tokens: 1 } },
  }),
  model: "stub/model",
  agentId,
  anchor,
  publicUrl: `http://127.0.0.1:${PORT}`,
  batcher,
  relayCosign: (args) => sendTx(clients, { address: anchor, abi: anchorWriteAbi, functionName: "cosign", args }),
});
const server = serve({ fetch: app.fetch, port: PORT });

try {
  // 4. Requester: a passkey (node P-256 key standing in for an authenticator), committed via X-Assay-Cosigner.
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pubJwk = publicKey.export({ format: "jwk" });
  const qx = b64(pubJwk.x!);
  const qy = b64(pubJwk.y!);
  const cosigner = requesterKeyHash(qx, qy);

  const base = `http://127.0.0.1:${PORT}`;
  const ask = wrap(fetch, { cosigner });
  const messages = [{ role: "user", content: "Say OK" }];
  const out = await ask(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "stub/model", messages, max_tokens: 16, temperature: 0 }),
  });
  check("receipt returned with the response", !!out.receipt.jws, out.receipt.hash);
  check("output commit matches the text returned", out.outputCommitOk);
  check("receipt names the requester's key (D19)", out.receipt.body.req.cosigner === cosigner);

  // 5. Batcher anchors the batch on chain with the host's P-256 signature.
  const anchorTx = await batcher.tick();
  check("batch anchored onchain", !!anchorTx, anchorTx ?? "no tx");

  const proofRes = await (await fetch(`${base}/v1/receipts/${out.receipt.hash}`)).json();
  check("host serves the proof", Array.isArray(proofRes.proof), `root ${proofRes.root}`);

  // 6. Requester co-signs with the passkey: WebAuthn assertion over the receipt hash, relayed by the host.
  const authData = Buffer.concat([createHash("sha256").update("localhost").digest(), Buffer.from([0x05]), Buffer.alloc(4)]);
  const challenge = Buffer.from(out.receipt.hash.slice(2), "hex").toString("base64url");
  const cdj = JSON.stringify({ type: "webauthn.get", challenge, origin: "http://localhost:5173", crossOrigin: false });
  const digest = Buffer.concat([authData, createHash("sha256").update(cdj).digest()]);
  const der = signDer("sha256", digest, privateKey);
  const auth = assertionToWebAuthnAuth({ authenticatorData: authData, clientDataJSON: new TextEncoder().encode(cdj), signature: der });
  const cos = await fetch(`${base}/v1/cosign`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      receiptHash: out.receipt.hash,
      qx,
      qy,
      auth: { ...auth, challengeIndex: auth.challengeIndex.toString(), typeIndex: auth.typeIndex.toString() },
    }),
  });
  const cosJson = await cos.json();
  check("passkey co-signature relayed onchain", cos.status === 200, cosJson.txHash ?? JSON.stringify(cosJson));

  // 7. Anyone can now verify the receipt end to end: signature, proof, anchor, commits, co-signature.
  const jwks = await (await fetch(`${base}/.well-known/jwks.json`)).json();
  const v = await verifyReceipt({
    body: out.receipt.body,
    jws: out.receipt.jws,
    jwks,
    proof: proofRes.proof,
    root: proofRes.root,
    onchain: { client: pub as any, anchor },
    salt: `0x${out.salt.replace(/^0x/, "")}` as Hex,
    output: "OK",
    messages,
    params: out.receipt.body.req.params,
  });
  for (const [k, s] of Object.entries(v.checks)) check(`verifyReceipt: ${k}`, s === "pass", s);

  const onchain = (await pub.readContract({
    address: anchor,
    abi: anchorWriteAbi,
    functionName: "verifyReceipt",
    args: [agentId, out.receipt.hash, proofRes.proof, proofRes.root],
  })) as boolean;
  check("ReceiptAnchor.verifyReceipt onchain", onchain);
} finally {
  server.close();
}

const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
