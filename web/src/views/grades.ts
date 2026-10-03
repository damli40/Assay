import { gradeOf, gradeStatus, type Grade, type GradeStatus } from "@assay/receipts";
import { copyButton, errorText, field, h, input, liveRegion, mono, section, textarea } from "../dom.js";
import { DEFAULT_RPC, EXPLORER, VERIFIER_REGISTRY } from "../lib/config.js";
import { chainClient } from "../lib/chain.js";
import { hostKeyFromInput, loadTrusted, modelKey, parseAddresses, saveTrusted } from "../lib/grades.js";
import type { Address } from "viem";

const MEANING: Record<GradeStatus, string> = {
  pass: "Graded recently with enough samples, and not below the reference.",
  warn: "Graded recently, but on fewer than 30 samples.",
  fail: "Below the reference: the host's best case is under the reference's worst case.",
  unknown: "No recent grade from a verifier you trust (none, or older than 7 days).",
};

const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;

export function renderGrade(found: { grade: Grade; by: Address } | null, status: GradeStatus, evidenceBase: string): HTMLElement {
  if (!found) {
    return h("div", { class: "card empty" }, h("p", {}, "No grade yet."), h("p", { class: "hint" }, "None of the verifiers you trust has graded this model on this host. Add another verifier or check the host input."));
  }
  const { grade: g, by } = found;
  const evidence = evidenceBase.trim() ? h("a", { href: `${evidenceBase.trim().replace(/\/+$/, "")}/${g.evidence}`, target: "_blank", rel: "noopener" }, "Open evidence") : null;
  return h(
    "div",
    { class: "card" },
    h("p", { class: `verdict ${status === "pass" ? "ok" : status === "fail" ? "bad" : ""}` }, h("span", { class: `badge ${status}` }, status), " ", MEANING[status]),
    h("dl", { class: "kv" },
      h("dt", {}, "Passed"), h("dd", {}, `${g.passed} of ${g.total}`),
      h("dt", {}, "95% interval"), h("dd", {}, `${pct(g.ciLowBps)} to ${pct(g.ciHighBps)}`),
      h("dt", {}, "Samples (n)"), h("dd", {}, String(g.total)),
      h("dt", {}, "Graded at"), h("dd", {}, new Date(Number(g.t) * 1000).toISOString()),
      h("dt", {}, "Verifier"), h("dd", {}, h("a", { href: `${EXPLORER}/address/${by}`, target: "_blank", rel: "noopener" }, by)),
      h("dt", {}, "Evidence sha256"), h("dd", {}, mono(g.evidence), " ", copyButton(g.evidence), " ", evidence),
      h("dt", {}, "Reference model"), h("dd", {}, mono(g.refModel)),
      h("dt", {}, "Check suite"), h("dd", {}, mono(g.checks)),
    ),
  );
}

export function mountGrades(root: HTMLElement) {
  const model = field("Model", input("z-ai/glm-5.3"), "Hashed as keccak256(model).");
  const host = field("Host", input("1962"), "An ERC-8004 agent id for an Assay host, or an OpenRouter provider tag such as deepinfra/fp8.");
  const trusted = field("Trusted verifiers", textarea({ rows: "2", placeholder: "0x… one per line" }), "Grades count only from these addresses. Ties go to the one listed first. Remembered in this browser.");
  trusted.input.value = loadTrusted().join("\n");
  const reference = field("Reference endpoint (optional)", input(""), "OpenRouter tag of the lab's own endpoint. With it, a host clearly below the reference shows as fail.");
  const evidence = field("Evidence base URL (optional)", input(""), "Where the verifier publishes its log bundles, named by sha256.");
  const rpc = field("RPC URL", input(DEFAULT_RPC));
  const registry = field("VerifierRegistry", input(VERIFIER_REGISTRY));
  const status = liveRegion();
  const keyInfo = h("div");
  const results = h("div");
  const form = h(
    "form",
    { class: "card" },
    model.row,
    host.row,
    trusted.row,
    reference.row,
    h("details", {}, h("summary", {}, "More settings"), evidence.row, rpc.row, registry.row),
    h("button", { type: "submit" }, "Look up grade"),
    status.el,
  );

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    results.replaceChildren();
    keyInfo.replaceChildren();
    try {
      const m = modelKey(model.input.value);
      const hk = hostKeyFromInput(host.input.value);
      const list = parseAddresses(trusted.input.value);
      if (list.length === 0) throw new Error("Add at least one verifier address you trust.");
      saveTrusted(list);
      keyInfo.append(h("p", { class: "hint" }, `hostKey = keccak256("${hk.preimage}") = `, mono(hk.hostKey)));
      status.say("Reading VerifierRegistry…");
      const client = chainClient(rpc.input.value);
      const reg = registry.input.value.trim() as Address;
      const found = await gradeOf(client, reg, m, hk.hostKey, list);
      const ref = reference.input.value.trim() ? await gradeOf(client, reg, m, hostKeyFromInput(reference.input.value).hostKey, list) : null;
      const st = gradeStatus(found?.grade, { now: BigInt(Math.floor(Date.now() / 1000)), reference: ref?.grade });
      results.append(renderGrade(found, st, evidence.input.value));
      status.say(found ? `Status: ${st}.` : "No grade found.", "ok");
    } catch (e) {
      status.say(errorText(e), "error");
    }
  });

  root.append(section("Grades", "Open verifiers compare a host's answers with the lab's own endpoint and post grades onchain. You choose whose grades count.", form, keyInfo, results));
}
