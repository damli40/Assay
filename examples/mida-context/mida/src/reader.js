import { isMidaSdkError } from "@mida-context/sdk";
import {
  PartialListError,
  midaErrorLine,
  readAssayRecord,
  toInteropRecord,
} from "./record.js";

const short = (id) => (typeof id === "string" && id.length > 12 ? `${id.slice(0, 10)}…` : id);
const shortAddr = (a) => (typeof a === "string" && a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const rpcHost = (rpcUrl) => {
  try {
    return new URL(rpcUrl).host;
  } catch {
    return rpcUrl;
  }
};
const stamp = (writtenAt) => new Date(writtenAt).toISOString().replace(/\.\d{3}Z$/, "Z");
const refuse = (message, exitCode = 2, outcome = "refused") =>
  Object.assign(new Error(message), { name: "RefusalError", exitCode, outcome });

// The pins ASSAY's check reads come from OUR config, never the record: the hosts we accept and,
// per chain, the ReceiptAnchor address and the RPC to read it over. The viem client is ours —
// it is what pins.chains[chainId].rpc would build anyway — so the record can never redirect the
// read. The chain read always runs; a no-chain check would accept a forged record.
export function chainPins(config, client) {
  return {
    trustedHosts: config.trustedHosts,
    chains: { [config.chainId]: { anchor: config.receiptAnchor, rpc: config.rpcUrl } },
    client,
  };
}

// ASSAY's own checkRecord on the interop record, called by both the reader and the writer. A
// throw out of his check (a chain or RPC failure) is exit 4 — never reported as ok — and the
// line carries only the error's name, never its message, the URL's path or the request body.
// `tail` is the caller's closing sentence ("Nothing was written." / "The context was not handed on.").
export async function checkOrRefuse({ assay, record, config, client, tail }) {
  let verdict;
  try {
    verdict = await assay.checkRecord(record, chainPins(config, client));
  } catch (e) {
    throw refuse(
      `chain: could not read ReceiptAnchor at ${shortAddr(config.receiptAnchor)} over ${rpcHost(config.rpcUrl)} (${e?.name ?? "Error"}). ${tail}`,
      4,
      "chain",
    );
  }
  if (verdict?.ok === true && Array.isArray(verdict.reasons) && verdict.reasons.length === 0) {
    return verdict;
  }
  const reasons = Array.isArray(verdict?.reasons)
    ? verdict.reasons.join("; ")
    : "the check returned no reasons";
  throw refuse(
    `refused: ASSAY's check did not pass for receipt ${short(record.receiptHash)} — ${reasons}. ${tail}`,
  );
}

// spec section-5 step 3: find the newest record the chain attributes to the writer, then run
// ASSAY's own checkRecord on it. The output is handed on only when verdict.ok === true AND
// verdict.reasons is empty — anything else prints his reasons and exits 2. A throw out of his
// check (a chain or RPC failure) exits 4 and is never reported as ok.
export async function runRead({ config, assay, client, mida, log, receiptHash }) {
  try {
    const found = await readAssayRecord(mida, config, { receiptHash });
    if (!found) {
      throw refuse(
        `read: no record written by ${config.writerAgent} with assayReceipt 1 in projects.current. Nothing was checked.`,
      );
    }
    const { item, id, author, writtenAt, record } = found;
    log(
      `mida: record ${short(id)} written by ${author?.name ?? "unknown"} (${item.source}, ${stamp(writtenAt)}) holds receipt ${short(record.receiptHash)}`,
    );

    const verdict = await checkOrRefuse({
      assay,
      record: toInteropRecord(record),
      config,
      client,
      tail: "The context was not handed on.",
    });
    const body = verdict.body ?? {};
    log(
      `accepted: host ${body?.host?.agentId} (trusted) served model ${body?.model}; the salt opens the commitments. Output: ${JSON.stringify(record.output)}`,
    );
    return { exitCode: 0, outcome: "accepted", output: record.output };
  } catch (e) {
    if (e instanceof PartialListError) {
      log(
        "mida: the record list came back incomplete (the store has not verified its newest rows yet). Nothing was checked. Run again in a minute.",
      );
      return { exitCode: 3, outcome: "partial" };
    }
    if (isMidaSdkError(e)) {
      log(midaErrorLine(e, "checked"));
      return { exitCode: 3, outcome: "mida" };
    }
    if (Number.isInteger(e?.exitCode)) {
      log(e.message);
      return { exitCode: e.exitCode, outcome: e.outcome ?? "refused" };
    }
    throw e;
  }
}
