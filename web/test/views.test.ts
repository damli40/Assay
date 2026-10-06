// @vitest-environment happy-dom
import type { Grade, VerifyResult } from "@assay/receipts";
import { describe, expect, it } from "vitest";
import { mountAsk } from "../src/views/ask.js";
import { mountGrades, renderGrade } from "../src/views/grades.js";
import { mountVault } from "../src/views/vault.js";
import { CHECKS, formatReproduce, mountVerify, renderResult } from "../src/views/verify.js";

const hash = `0x${"aa".repeat(32)}` as const;
const root = `0x${"bb".repeat(32)}` as const;
const anchor = "0x049A73755cA3508ef3Daa4752A3406f6e00CfB13";
const rpc = "https://testnet-rpc.monad.xyz";

const result: VerifyResult = {
  ok: false,
  receiptHash: hash,
  checks: { jws: "pass", hash: "pass", kid: "pass", merkle: "pass", anchored: "fail", outputCommit: "pass", promptCommit: "skipped", cosigned: "skipped" },
  reproduce: {
    jws: { kind: "jws", kid: "key-1", alg: "ES256", payload: "JCS(body)" },
    merkle: { kind: "compute", what: "StandardMerkleTree.verify", inputs: { receiptHash: hash }, expect: root },
    anchored: { kind: "contract-call", address: anchor, function: "anchors(uint256,bytes32)(uint32,uint64)", args: ["1962", root], expect: "anchoredAt != 0" },
    outputCommit: { kind: "compute", what: "sha256(salt || utf8(output))", inputs: { output: "<img src=x onerror=alert(1)>" }, expect: hash },
  },
};

describe("verify view", () => {
  const el = renderResult(result, { rpc, notes: ["Host unreachable."] });
  const row = (k: string) => el.querySelector(`[data-check="${k}"]`)!;

  it("renders one row per check, in order, with its state", () => {
    const rows = [...el.querySelectorAll(".check")];
    expect(rows.map((r) => r.getAttribute("data-check"))).toEqual(CHECKS.map((c) => c.key));
    expect(row("anchored").querySelector(".badge")!.textContent).toBe("Fail");
    expect(row("jws").classList.contains("pass")).toBe(true);
  });

  it("says the receipt failed and shows notes", () => {
    expect(el.querySelector(".verdict")!.textContent).toMatch(/failed/);
    expect(el.textContent).toContain("Host unreachable.");
  });

  it("explains skipped checks by what they need, and has no reproduce line for them", () => {
    expect(row("promptCommit").textContent).toMatch(/salt and the messages/);
    expect(row("promptCommit").querySelector(".repro")).toBeNull();
  });

  it("gives a cast line for contract calls", () => {
    expect(row("anchored").querySelector("pre")!.textContent).toBe(
      `cast call ${anchor} "anchors(uint256,bytes32)(uint32,uint64)" 1962 ${root} --rpc-url ${rpc}\n# expect anchoredAt != 0`,
    );
  });

  it("renders untrusted inputs as text, never HTML", () => {
    expect(row("outputCommit").querySelector("img")).toBeNull();
    expect(row("outputCommit").textContent).toContain("<img src=x");
  });

  it("reads a named co-signer who hasn't co-signed as not yet, and doesn't fail the receipt for it", () => {
    const waiting = renderResult({ ...result, checks: { ...result.checks, anchored: "pass", cosigned: "fail" } }, { rpc });
    expect(waiting.querySelector('[data-check="cosigned"] .badge')!.textContent).toBe("Not yet");
    expect(waiting.querySelector(".verdict")!.textContent).toBe("No check failed.");
  });

  it("formats the jws line", () => {
    expect(formatReproduce(result.reproduce.jws!, rpc)).toContain('JWKS key "key-1"');
  });
});

describe("pages", () => {
  it.each([
    ["verify", mountVerify],
    ["ask", mountAsk],
    ["grades", mountGrades],
    ["vault", mountVault],
  ] as const)("%s mounts with a labelled control for every input", (_, mount) => {
    const main = document.createElement("main");
    mount(main);
    expect(main.querySelector("h1")).not.toBeNull();
    for (const el of main.querySelectorAll("input, textarea")) expect(main.querySelector(`label[for="${el.id}"]`)).not.toBeNull();
  });
});

describe("grades view", () => {
  it("shows an empty state when nobody graded", () => {
    expect(renderGrade(null, "unknown", "").textContent).toMatch(/No grade yet/);
  });

  it("shows status, interval, n and an evidence link", () => {
    const g: Grade = { model: hash, hostKey: hash, checks: hash, passed: 47, total: 50, ciLowBps: 8380, ciHighBps: 9790, refModel: hash, evidence: root, t: 1_790_000_000n };
    const el = renderGrade({ grade: g, by: anchor }, "pass", "https://example.org/ev/");
    expect(el.textContent).toContain("47 of 50");
    expect(el.textContent).toContain("83.80% to 97.90%");
    expect(el.querySelector(".badge")!.textContent).toBe("pass");
    expect(el.querySelector(`a[href="https://example.org/ev/${root.slice(2)}.tar.gz"]`)).not.toBeNull();
  });
});
