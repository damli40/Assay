import { isMidaSdkError } from "@mida-context/sdk";
import { checkLine, judge } from "./check.js";
import {
  PartialListError,
  bodyFromJws,
  midaErrorLine,
  readAssayRecord,
  toVerifyInput,
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

// spec section-5 step 3: find the newest record the chain attributes to the writer, run their
// check on it, and hand the output onward only when every applicable check passed and the host
// is trusted. result.ok from their verifyReceipt is never read.
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

    const input = toVerifyInput(record, { client, anchor: config.receiptAnchor });
    let result;
    try {
      result = await assay.verifyReceipt(input);
    } catch (e) {
      throw refuse(
        `chain: could not read ReceiptAnchor at ${shortAddr(config.receiptAnchor)} over ${rpcHost(config.rpcUrl)} (${e?.name ?? "Error"}). The context was not handed on.`,
        4,
        "chain",
      );
    }
    log(checkLine(result, { contract: config.receiptAnchor, agentId: record.anchor.agentId }));
    const verdict = judge(result, {
      trustedHosts: config.trustedHosts,
      body: bodyFromJws(record.jws, "handed on"),
      hasMessages: record.messages !== undefined,
      output: record.output,
    });
    log(verdict.line);
    if (verdict.kind === "accept") return { exitCode: 0, outcome: "accepted", output: record.output };
    return { exitCode: 2, outcome: verdict.code };
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
