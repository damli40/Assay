import { describe, expect, it } from "vitest";
import { checkLine, judge } from "../src/check.js";

const HASH = "0x9a166cacb2ffe4784ad556f69b690b7cebf71150f737a5a3c324f9e98e7907e5";
const ANCHOR = { contract: "0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24", agentId: 1962 };
const BODY = {
  v: "assay-receipt/0",
  model: "gemma-4-31b-it",
  host: { agentId: "erc8004:10143:1962", keyId: "kid1", alg: "ES256" },
  req: { commit: "0x" + "22".repeat(32), params: {} },
  res: { commit: "0x" + "33".repeat(32), tokensIn: 3, tokensOut: 1, finish: "stop" },
  t: 1,
  nonce: "0x" + "44".repeat(16),
};
const TRUSTED = ["erc8004:10143:1962"];

const allPass = (over = {}) => ({
  ok: true,
  receiptHash: HASH,
  checks: {
    jws: "pass", hash: "pass", kid: "pass", merkle: "pass", anchored: "pass",
    outputCommit: "pass", promptCommit: "pass", cosigned: "skipped",
    ...over,
  },
  reproduce: {},
});

const args = (over = {}) => ({ trustedHosts: TRUSTED, body: BODY, hasMessages: true, output: "OK", ...over });

describe("judge", () => {
  it("accepts when every required check passes and the host is trusted", () => {
    expect(judge(allPass(), args())).toEqual({
      kind: "accept",
      line: 'accepted: host erc8004:10143:1962 (trusted) served model gemma-4-31b-it; the salt opens the commitments. Output: "OK"',
    });
  });

  it("refuses a skipped anchored even when ok is true — ok is never read", () => {
    const result = allPass({ anchored: "skipped" });
    expect(result.ok).toBe(true);
    const verdict = judge(result, args());
    expect(verdict.kind).toBe("refuse");
    expect(verdict.code).toBe("checks");
    expect(verdict.line).toBe(
      `refused: ASSAY's check did not pass for receipt 0x9a166cac… — anchored: skipped. The context was not handed on.`,
    );
  });

  it("refuses a failed cosigned even when every required check passes", () => {
    const result = allPass({ cosigned: "fail" });
    result.ok = false;
    const verdict = judge(result, args());
    expect(verdict.kind).toBe("refuse");
    expect(verdict.line).toContain("cosigned: fail");
  });

  it("requires promptCommit pass only when messages are kept", () => {
    expect(judge(allPass({ promptCommit: "skipped" }), args()).kind).toBe("refuse");
    expect(judge(allPass({ promptCommit: "skipped" }), args({ hasMessages: false })).kind).toBe("accept");
    const verdict = judge(allPass({ promptCommit: "fail" }), args({ hasMessages: false }));
    expect(verdict.kind).toBe("refuse");
    expect(verdict.line).toContain("promptCommit: fail");
  });

  it("lists every check that is not pass, in the SDK's order", () => {
    const verdict = judge(
      allPass({ hash: "fail", anchored: "skipped", outputCommit: "fail" }),
      args(),
    );
    expect(verdict.line).toBe(
      `refused: ASSAY's check did not pass for receipt 0x9a166cac… — hash: fail, anchored: skipped, outputCommit: fail. The context was not handed on.`,
    );
  });

  it("refuses a host that is not in the trusted list", () => {
    const body = { ...BODY, host: { ...BODY.host, agentId: "erc8004:10143:4242" } };
    const verdict = judge(allPass(), args({ body }));
    expect(verdict).toEqual({
      kind: "refuse",
      code: "untrusted-host",
      line: `refused: receipt 0x9a166cac… was anchored by host erc8004:10143:4242, which is not in ASSAY_TRUSTED_HOSTS (erc8004:10143:1962). The context was not handed on.`,
    });
  });
});

describe("checkLine", () => {
  it("renders the section-3.4 check line", () => {
    expect(checkLine(allPass(), ANCHOR)).toBe(
      "assay: jws pass · hash pass · kid pass · merkle pass · anchored pass (host 1962 on 0x63e4…1a24) · outputCommit pass · promptCommit pass · cosigned skipped",
    );
  });
});
