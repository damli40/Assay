import { gradeOf, gradeStatus, type Grade, type GradeStatus } from "@assay/receipts";
import { copyButton, emptyState, errorText, field, h, input, liveRegion, mono, section, textarea } from "../dom.js";
import { showPageChain } from "../ui/network-switch.js";
import { CHAIN_ID, CHAINS, EXPLORER, chainConfig, chainOfAgentId } from "../lib/config.js";
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

export function renderGrade(found: { grade: Grade; by: Address } | null, status: GradeStatus, evidenceBase: string, next: HTMLElement | null = null): HTMLElement {
  if (!found) {
    return h("div", { class: "card empty" }, h("p", {}, "No grade yet."), h("p", { class: "hint" }, "None of the verifiers you trust has graded this model on this host. Add another verifier or check the host input."));
  }
  const { grade: g, by } = found;
  // Bundles are published as <sha256 without 0x>.tar.gz.
  const evidence = evidenceBase.trim() ? h("a", { href: `${evidenceBase.trim().replace(/\/+$/, "")}/${g.evidence.slice(2)}.tar.gz`, target: "_blank", rel: "noopener" }, "Open evidence") : null;
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
      h("dt", {}, "Evidence sha256"), h("dd", {}, mono(g.evidence), " ", copyButton(g.evidence, "Copy evidence hash", { iconOnly: true }), " ", evidence),
      h("dt", {}, "Reference model"), h("dd", {}, mono(g.refModel)),
      h("dt", {}, "Check suite"), h("dd", {}, mono(g.checks)),
    ),
    next,
  );
}

/// Assay runs the only verifier so far; the same address is registered on testnet and mainnet.
export const ASSAY_VERIFIER = "0x4BaC2Be288B5931886EeC4c555895CE6BcAB19e7";
const EVIDENCE_BASE = "https://raw.githubusercontent.com/trudransh/Assay/main/cre/grade-recheck/fixtures/evidence";

/// ?chain= wins, then the chain named in an erc8004 host, then the network picked in the top bar.
export function gradesChain(params: URLSearchParams): number {
  const asked = Number(params.get("chain"));
  if (CHAINS[asked]) return asked;
  const fromHost = chainOfAgentId(params.get("host") ?? "");
  return fromHost && CHAINS[fromHost] ? fromHost : CHAIN_ID;
}

export function mountGrades(root: HTMLElement, params: URLSearchParams = new URLSearchParams()) {
  const chainId = gradesChain(params);
  const net = chainConfig(chainId);
  showPageChain(chainId);
  const model = field("Model", input(params.get("model") ?? "gemma-4-31b-it"), "Hashed as keccak256(model). Use the id the host claims in its receipts.");
  const host = field("Host", input(params.get("host") ?? `erc8004:${chainId}:${net.referenceHost}`), `An Assay host as erc8004:<chain>:<id> or a bare agent id on ${net.name}, an OpenRouter provider tag such as deepinfra/fp8, or direct:<api host>.`);
  const trusted = field("Trusted verifiers", textarea({ rows: "2", placeholder: "0x… one per line" }), "Grades count only from these addresses. Ties go to the one listed first. Remembered in this browser.");
  trusted.input.value = params.get("v")?.split(",").join("\n") ?? loadTrusted().join("\n");
  const useAssay = h("button", { type: "button", class: "btn btn-secondary btn-sm" }, "Use Assay's verifier");
  useAssay.addEventListener("click", () => {
    const list = trusted.input.value.split(/\s+/).filter(Boolean);
    if (!list.some((a) => a.toLowerCase() === ASSAY_VERIFIER.toLowerCase())) trusted.input.value = [...list, ASSAY_VERIFIER].join("\n");
    trusted.input.focus();
  });
  const disclosure = h(
    "div",
    { class: "row verifier-note" },
    h("p", { class: "hint" }, `So far the only verifier posting grades is run by Assay itself (${ASSAY_VERIFIER.slice(0, 6)}…${ASSAY_VERIFIER.slice(-4)}). Trusting it is your choice.`),
    useAssay,
  );
  const reference = field("Reference endpoint (optional)", input(params.get("ref") ?? ""), "The lab's own endpoint, e.g. direct:generativelanguage.googleapis.com or an OpenRouter tag. With it, a host clearly below the reference shows as fail.");
  const evidence = field("Evidence base URL (optional)", input(EVIDENCE_BASE), "Where the verifier publishes its log bundles, named by sha256.");
  const rpc = field("RPC URL", input(net.rpc));
  const registry = field("VerifierRegistry", input(net.verifierRegistry), `On ${net.name}.`);
  const status = liveRegion();
  const keyInfo = h("div");
  const results = h("div");
  const form = h(
    "form",
    { class: "card" },
    model.row,
    host.row,
    trusted.row,
    disclosure,
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
      const hk = hostKeyFromInput(host.input.value, chainId);
      const list = parseAddresses(trusted.input.value);
      if (list.length === 0) throw new Error("Add at least one verifier address you trust.");
      saveTrusted(list);
      keyInfo.append(h("p", { class: "hint" }, `hostKey = keccak256("${hk.preimage}") = `, mono(hk.hostKey)));
      status.say("Reading VerifierRegistry…");
      const client = chainClient(rpc.input.value);
      const reg = registry.input.value.trim() as Address;
      const found = await gradeOf(client, reg, m, hk.hostKey, list);
      const ref = reference.input.value.trim() ? await gradeOf(client, reg, m, hostKeyFromInput(reference.input.value, chainId).hostKey, list) : null;
      const st = gradeStatus(found?.grade, { now: BigInt(Math.floor(Date.now() / 1000)), reference: ref?.grade });
      // Onward links: an Assay host opens its profile, where its batches and receipts are.
      const agent = /^erc8004:(\d+):(\d+)$/.exec(hk.preimage);
      const next = agent ? h("div", { class: "row" }, h("a", { class: "btn btn-secondary btn-sm", href: `#hosts/${agent[2]}?chain=${agent[1]}` }, "Open the host's profile")) : null;
      results.replaceChildren(renderGrade(found, st, evidence.input.value, next));
      status.say(found ? `Status: ${st}.` : "No grade found.", "ok");
    } catch (e) {
      status.say(errorText(e), "error");
    }
  });

  // A deep link with everything filled in runs the lookup straight away.
  if (params.get("model") && params.get("host") && trusted.input.value.trim()) queueMicrotask(() => form.requestSubmit());
  // Before a lookup, the result column offers real grades to start from, so the page is never a blank form.
  const start = (label: string, href: string) => h("a", { class: "btn btn-secondary btn-sm", href }, label);
  results.append(
    emptyState({
      title: "Pick a host, or start from a real grade",
      text: "Each link fills the form and runs the lookup with Assay's verifier, the only one posting so far.",
      tone: "lime",
      action: h(
        "div",
        { class: "row" },
        start(`Assay's host on ${net.name}`, `#grades?model=gemma-4-31b-it&host=erc8004:${chainId}:${net.referenceHost}&ref=direct:generativelanguage.googleapis.com&chain=${chainId}&v=${ASSAY_VERIFIER}`),
        start("GLM-5.3, 39 OpenRouter hosts", `#grades?model=z-ai/glm-5.3&host=openrouter:inference-net&ref=openrouter:z-ai/fp8&chain=10143&v=${ASSAY_VERIFIER}`),
      ),
    }),
  );
  root.append(section("Grades", `Open verifiers compare a host's answers with the lab's own endpoint and post grades onchain. You choose whose grades count. Reading from ${net.name}.`, h("div", { class: "receipt-grid ask-grid" }, form, h("div", { class: "col" }, results, keyInfo))));
}
