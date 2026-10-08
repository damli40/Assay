// Before an agent trusts context from a Mida record, check the Assay receipt inside it.
// The record (Mida's encrypted body) carries Assay's interop shape plus the opening:
//   { receiptHash, chainId, jws, jwks, anchor: { agentId, root, proof, tx }, salt, output, messages }
// Fails closed: any problem means the agent refuses the context. The logic is checkRecord in the SDK.
//
//   npx tsx examples/mida-context/check.mts record.json            # with the onchain anchor check
//   npx tsx examples/mida-context/check.mts record.json --offline  # CI: everything except the chain read
import { readFileSync } from "node:fs";
import { checkRecord, type RecordPins } from "../../sdk/src/index.js";

// Your pins, never the record's: the hosts you accept, and where to read each chain.
const PINS: RecordPins = {
  trustedHosts: ["erc8004:10143:1962", "erc8004:143:10278"],
  chains: {
    10143: { anchor: "0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24", rpc: "https://testnet-rpc.monad.xyz" },
    143: { anchor: "0x049A73755cA3508ef3Daa4752A3406f6e00CfB13", rpc: "https://rpc.monad.xyz" },
  },
  // RFC 7638 thumbprint of the hosts' signing key (both hosts use it; it's their kid in /.well-known/jwks.json).
  // Offline, only a record signed by a pinned key can pass: the record's own JWKS proves nothing on its own.
  pinnedKeys: ["2Jc6WJSjvNSL7jid_XaVkG4iVOIBr7HSqhk1KiF5qg0"],
};

const [file, flag] = process.argv.slice(2);
if (!file) {
  console.error("usage: check.mts <record.json> [--offline]");
  process.exit(2);
}
const offline = flag === "--offline";
const v = await checkRecord(JSON.parse(readFileSync(file, "utf8")), { ...PINS, offline });
if (!v.ok) {
  console.error(`refused: ${v.reasons.join("; ")}`);
  process.exit(1);
}
console.log(
  v.onchain
    ? `ok: ${v.body!.host.agentId} served this output to this prompt (${v.body!.model}), anchored on Monad. Use the context.`
    : `ok (offline, not checked on chain): signed by a pinned key of ${v.body!.host.agentId}, and the salt opens both commits. The anchor was not read, so don't treat this as acceptance.`,
);
