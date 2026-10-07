// Their verifyReceipt returns `ok` plus the per-check verdicts. `ok` is true whenever nothing
// FAILED — including checks that were skipped — so this module never reads it. R6 runs on the
// eight verdicts; R7 pins the signed body's host against the configured list, only after the
// receipt-hash and JWS checks have established the body is authentic.

const ORDER = ["jws", "hash", "kid", "merkle", "anchored", "outputCommit", "promptCommit", "cosigned"];
const REQUIRED = new Set(["jws", "hash", "kid", "merkle", "anchored", "outputCommit"]);

const short = (id) => (typeof id === "string" && id.length > 12 ? `${id.slice(0, 10)}…` : id);
const shortAddr = (a) => (typeof a === "string" && a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export function judge(result, { trustedHosts, body, hasMessages, output }) {
  const checks = result?.checks ?? {};
  const bad = [];
  for (const name of ORDER) {
    const status = checks[name] ?? "skipped";
    if (
      (REQUIRED.has(name) && status !== "pass") ||
      (name === "promptCommit" && (hasMessages ? status !== "pass" : status === "fail")) ||
      (name === "cosigned" && status === "fail")
    ) {
      bad.push(`${name}: ${status}`);
    }
  }
  const hash = short(result?.receiptHash);
  if (bad.length > 0) {
    return {
      kind: "refuse",
      code: "checks",
      line: `refused: ASSAY's check did not pass for receipt ${hash} — ${bad.join(", ")}. The context was not handed on.`,
    };
  }
  const agentId = body?.host?.agentId;
  if (!trustedHosts.includes(agentId)) {
    return {
      kind: "refuse",
      code: "untrusted-host",
      line: `refused: receipt ${hash} was anchored by host ${agentId}, which is not in ASSAY_TRUSTED_HOSTS (${trustedHosts.join(", ")}). The context was not handed on.`,
    };
  }
  return {
    kind: "accept",
    line: `accepted: host ${agentId} (trusted) served model ${body?.model}; the salt opens the commitments. Output: ${JSON.stringify(output)}`,
  };
}

// The section-3.4 second line — the check strip, with the host and contract inside the
// anchored entry. `anchor` here is { contract, agentId }.
export function checkLine(result, anchor) {
  const checks = result?.checks ?? {};
  const parts = ORDER.map((name) => {
    let part = `${name} ${checks[name] ?? "skipped"}`;
    if (name === "anchored") part += ` (host ${anchor?.agentId} on ${shortAddr(anchor?.contract)})`;
    return part;
  });
  return `assay: ${parts.join(" · ")}`;
}
