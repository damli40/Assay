// One real request through a running host, then waits for its anchor and checks verifyReceipt onchain.
// Costs one upstream call; the host pays the anchor gas. Env: HOST_URL?, MONAD_RPC_URL, ANCHOR_ADDRESS, E2E_TIMEOUT_S?
import { newSalt, verifyReceipt, type ReceiptBody } from "@assay/receipts";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { anchorWriteAbi, monadTestnet } from "../src/chain.js";

const hostUrl = process.env.HOST_URL ?? "http://localhost:8787";
const rpc = process.env.MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";
const anchor = process.env.ANCHOR_ADDRESS as Address;
if (!anchor) throw new Error("ANCHOR_ADDRESS is required");
const timeoutMs = Number(process.env.E2E_TIMEOUT_S ?? 420) * 1000;

const salt = newSalt();
const messages = [{ role: "user", content: "Say OK" }];
const res = await fetch(`${hostUrl}/v1/chat/completions`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-assay-salt": salt.slice(2) },
  body: JSON.stringify({ messages, max_tokens: 256, temperature: 0 }),
});
if (!res.ok) throw new Error(`host returned ${res.status}: ${await res.text()}`);
const output = ((await res.json()) as { choices: { message: { content: string } }[] }).choices[0].message.content;
const hash = res.headers.get("x-assay-receipt-hash") as Hex;
console.log(`receipt ${hash}\noutput  ${JSON.stringify(output)}`);

type Anchored = { status: "anchored"; body: ReceiptBody; jws: string; root: Hex; proof: Hex[]; anchorTx: Hex };
const deadline = Date.now() + timeoutMs;
let r: Anchored | { status: "pending" };
for (;;) {
  r = (await (await fetch(`${hostUrl}/v1/receipts/${hash}`)).json()) as typeof r;
  if (r.status === "anchored") break;
  if (Date.now() > deadline) throw new Error("timed out waiting for the anchor (is BATCH_SECONDS longer than E2E_TIMEOUT_S?)");
  await new Promise((ok) => setTimeout(ok, 5000));
}

const client = createPublicClient({ chain: monadTestnet, transport: http(rpc) });
const agentId = BigInt(r.body.host.agentId.split(":")[2]);
const onchain = await client.readContract({ address: anchor, abi: anchorWriteAbi, functionName: "verifyReceipt", args: [agentId, hash, r.proof, r.root] });
const jwks = await (await fetch(`${hostUrl}/.well-known/jwks.json`)).json();
const full = await verifyReceipt({
  body: r.body,
  jws: r.jws,
  jwks,
  proof: r.proof,
  root: r.root,
  onchain: { client, anchor },
  salt,
  output,
  messages,
  params: r.body.req.params,
});

console.log(`anchor  https://testnet.monadvision.com/tx/${r.anchorTx}`);
console.log(`verifyReceipt onchain: ${onchain}`);
console.log(`SDK checks: ${JSON.stringify(full.checks)}`);
process.exit(onchain && full.ok ? 0 : 1);
