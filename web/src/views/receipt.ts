import {
  cosignerForAddress,
  gradeOf,
  gradeStatus,
  hostKeyForAgent,
  jcs,
  parseAgentId,
  verifyReceipt,
  type Checks,
  type Grade,
  type GradeStatus,
  type ReceiptBody,
  type VerifyInput,
  type VerifyResult,
} from "@assay/receipts";
import type { Address, Hex } from "viem";
import { badge, banner, button, chip, copyButton, emptyState, errorText, h, kv, levelLadder, shortHash, skeleton, stamp, toast } from "../dom.js";
import { chainClient } from "../lib/chain.js";
import { CHAIN_ID, DEFAULT_HOST, DEFAULT_RPC, EXPLORER, RECEIPT_ANCHOR, VERIFIER_REGISTRY } from "../lib/config.js";
import { loadTrusted, modelKey } from "../lib/grades.js";
import { fetchJwks, fetchReceiptStatus, httpStatus, type ReceiptStatus } from "../lib/host.js";
import { anchorInfo, type AnchorInfo, type AnchorReader } from "../lib/indexer.js";
import { heldReceipt, setVerifyPrefill } from "../lib/receipt.js";
import type { Route } from "../router.js";
import { CHECKS } from "./verify.js";

type Found = { grade: Grade; by: Address } | null;

export interface ReceiptDeps {
  status(hash: Hex): Promise<ReceiptStatus>;
  jwks(): Promise<VerifyInput["jwks"]>;
  client: AnchorReader;
  anchor(o: { agentId: bigint; root: Hex; receiptHash: Hex; anchorTx?: Hex }): Promise<AnchorInfo>;
  grade(model: Hex, hostKey: Hex, trusted: Address[]): Promise<Found>;
}

function defaultDeps(host: string): ReceiptDeps {
  const client = chainClient(DEFAULT_RPC) as unknown as AnchorReader;
  return {
    status: (hash) => fetchReceiptStatus(host, hash),
    jwks: () => fetchJwks(host),
    client,
    anchor: (o) => anchorInfo({ ...o, client, anchor: RECEIPT_ANCHOR }),
    grade: (model, hostKey, trusted) => gradeOf(client, VERIFIER_REGISTRY, model, hostKey, trusted),
  };
}

const link = (label: string, href: string, cls = "") => h("a", { href, class: cls, ...(href.startsWith("http") ? { target: "_blank", rel: "noopener" } : {}) }, label);
const card = (title: string, aside: Node | string | null, ...body: (Node | null)[]) =>
  h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", {}, title), typeof aside === "string" ? h("span", { class: "hint" }, aside) : aside), ...body);

/// Check states on this page: the salt checks can't run here, so they say why.
function checkLabel(key: keyof Checks, state: VerifyResult["checks"][keyof Checks]): string {
  if (state === "pass") return "Pass";
  if (state === "fail") return "Fail";
  if (key === "outputCommit" || key === "promptCommit") return "Needs salt";
  return key === "cosigned" ? "None" : "Skipped";
}

export function renderChecks(result: VerifyResult): HTMLElement {
  return h(
    "ul",
    { class: "checks compact" },
    ...CHECKS.map((c) => {
      const state = result.checks[c.key];
      return h("li", { class: `check ${state}`, "data-check": c.key }, h("strong", {}, c.name), badge(state, checkLabel(c.key, state)));
    }),
  );
}

function bodyCard(body: ReceiptBody): HTMLElement {
  const rows: [string, Node | string][] = [
    ["model", body.model],
    ["host.agentId", body.host.agentId],
    ["host.keyId", body.host.keyId],
    ["host.alg", body.host.alg],
    ["req.commit", body.req.commit],
    ["req.params", h("code", { class: "mono" }, JSON.stringify(body.req.params))],
    ["req.cosigner", body.req.cosigner ?? "none"],
    ["res.commit", body.res.commit],
    ["res.tokens", `${body.res.tokensIn} in · ${body.res.tokensOut} out · finish ${body.res.finish}`],
  ];
  if (body.price) rows.push(["price", `${body.price.amount} ${body.price.asset}`]);
  rows.push(["t", `${body.t} · ${new Date(body.t).toISOString()}`], ["nonce", h("code", { class: "mono" }, body.nonce)]);
  const list = kv(rows);
  list.classList.add("kv-mono");
  return card(
    "What the host signed",
    chip(body.v, "muted"),
    list,
    h("p", { class: "hint" }, "The prompt and output aren't here. Only their salted hashes are, and the person who asked holds the salt."),
  );
}

function cosignCard(body: ReceiptBody, info: AnchorInfo | null): HTMLElement {
  const aside = "From Cosigned events";
  if (!info?.cosigns) return card("Co-signatures", aside, h("p", { class: "hint" }, "The list of co-signatures comes from the indexer, which didn't answer. The Requester co-signed check reads the chain directly."));
  if (!info.cosigns.length) return card("Co-signatures", aside, h("p", { class: "hint" }, "Nobody has co-signed this receipt yet."));
  const list = h("ul", { class: "cosigns" });
  for (const c of info.cosigns) {
    const key = (c.kind === "K" ? cosignerForAddress(c.requester as Address) : c.requester).toLowerCase();
    const counts = key === body.req.cosigner?.toLowerCase();
    list.append(h("li", {}, shortHash(c.requester), chip(c.kind === "K" ? "secp256k1" : "P256", "muted"), counts ? chip("Counts: matches req.cosigner", "pink") : chip("Ignored", "muted")));
  }
  return card("Co-signatures", aside, list, h("p", { class: "hint" }, "Anyone can co-sign any receipt hash. Only the key the host signed into req.cosigner counts."));
}

function rawCard(body: ReceiptBody): HTMLElement {
  return h(
    "section",
    { class: "card" },
    h("div", { class: "card-head" }, h("h2", {}, "Raw receipt"), copyButton(jcs(body), "Copy JSON")),
    h("pre", { class: "raw" }, JSON.stringify(body, null, 2)),
    h("p", { class: "hint" }, "The host signs exactly the JCS bytes of this body. receiptHash = sha256(JCS(body))."),
  );
}

export function renderAnchorCard(info: AnchorInfo, root: Hex, cast?: string): HTMLElement {
  const block = info.block !== undefined ? (info.txHash ? link(`${info.block}`, `${EXPLORER}/tx/${info.txHash}`) : String(info.block)) : "unknown";
  const key = info.keyHash ? h("span", { class: "kv-hash" }, shortHash(info.keyHash), info.source === "rpc" ? chip("Current key", "muted") : null) : "unknown";
  const rows: [string, Node | string][] = [
    ["Contract", link(`ReceiptAnchor ${RECEIPT_ANCHOR.slice(0, 7)}…${RECEIPT_ANCHOR.slice(-4)}`, `${EXPLORER}/address/${RECEIPT_ANCHOR}`)],
    ["Root", root],
    ["Batch size", `${info.count} receipt${info.count === 1 ? "" : "s"}`],
    ["Signed by key", key],
    ["Block", block],
  ];
  if (info.txHash) rows.push(["Tx", info.txHash]);
  const source =
    info.source === "indexer"
      ? "Batch details from the Envio indexer."
      : "The indexer didn't answer, so these come from the chain. The key shown is the host's current key, which may be newer than this batch.";
  return h(
    "section",
    { class: "card anchor-card" },
    h("div", { class: "card-head" }, h("h2", {}, "Anchor"), chip("Anchored", "violet", { dot: true })),
    kv(rows),
    cast ? h("div", { class: "repro" }, h("pre", {}, cast), copyButton(cast, "Copy cast line")) : null,
    h("p", { class: "hint", "data-source": info.source }, source),
  );
}

function gradeCard(body: ReceiptBody, found: Found | undefined, status: GradeStatus, error?: string): HTMLElement {
  const agent = parseAgentId(body.host.agentId);
  const open = link("Open in Grades", `#grades?model=${encodeURIComponent(body.model)}&host=${agent}`);
  if (found === undefined && !error) {
    return emptyState({ title: "No trusted verifiers saved", text: "Choose whose grades count on the Grades tab. This page then shows their grade for this host.", tone: "lime", action: link("Open Grades", "#grades", "btn btn-secondary") });
  }
  const scope = `For ${body.model} on erc8004:${CHAIN_ID}:${agent}, from verifiers you trust. It grades the host, not this one response.`;
  if (error) return card("Host grade", badge("notchecked", "Not checked"), h("p", { class: "hint" }, `Couldn't read the grade (${error}).`));
  if (!found) return card("Host grade", badge("unknown", "unknown"), h("p", {}, "No grade yet. ", scope), open);
  const g = found.grade;
  const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;
  return card("Host grade", badge(status, status), h("p", {}, scope), h("p", {}, `Passed ${g.passed} of ${g.total}, 95% interval ${pct(g.ciLowBps)} to ${pct(g.ciHighBps)}.`), open);
}

function head(hash: Hex, body: ReceiptBody | undefined, anchored: boolean | undefined, cosigned: boolean, actions: HTMLElement | null): HTMLElement {
  const agent = body ? parseAgentId(body.host.agentId).toString() : undefined;
  const title = body ? `Served by agent ${agent}, claiming ${body.model}` : "Receipt";
  const lede = h("p", { class: "lede" }, "Receipt ", shortHash(hash), " ", copyButton(hash, "Copy hash"), " ", anchored === undefined ? "" : anchored ? "Anchored in a batch on Monad." : "Signed, not anchored yet.", cosigned ? " Co-signed by the requester." : "");
  const stamps = body
    ? h(
        "div",
        { class: "stamps" },
        stamp("host", agent!, true, `Host mark: agent ${agent}`),
        stamp("model", "claimed", true, `Model mark: claims ${body.model}`),
        stamp("anchor", anchored ? "monad" : "waiting", !!anchored, anchored ? "Anchor mark: anchored on Monad" : "Anchor mark: waiting for the batch"),
        stamp("you", "co-sign", cosigned, cosigned ? "Your mark: requester co-signed" : "Your mark: not co-signed"),
      )
    : null;
  return h(
    "header",
    { class: "receipt-head" },
    h("div", { class: "receipt-head-text" }, h("div", { class: "row" }, chip("Receipt", "gold"), chip("New page", "sky", { dashed: true })), h("h1", { id: "page-title" }, title), lede, actions),
    stamps,
  );
}

function actions(hash: Hex, held: { body: ReceiptBody; jws: string }, extra: Record<string, unknown>): HTMLElement {
  const verify = button("Verify with your salt", { variant: "primary" });
  verify.addEventListener("click", () => {
    setVerifyPrefill(JSON.stringify(held));
    location.hash = "#verify";
  });
  const copy = button("Copy link");
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      toast("Link copied");
    } catch {
      copy.textContent = "Copy failed";
    }
  });
  const download = button("Download bundle");
  download.addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ receiptHash: hash, ...held, ...extra }, null, 2)], { type: "application/json" }));
    h("a", { href: url, download: `assay-receipt-${hash.slice(2, 10)}.json` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  });
  return h("div", { class: "row actions" }, verify, copy, download);
}

const limits = () =>
  h("p", { class: "limits" }, "This receipt proves who served these bytes and what they claimed. It doesn't prove which weights ran.");

export function mountReceipt(root: HTMLElement, route: Route, deps: ReceiptDeps = defaultDeps(route.params.get("host") ?? DEFAULT_HOST)) {
  const hash = route.path[1] as Hex;
  const page = h("section", { class: "page receipt", "aria-labelledby": "page-title" });
  root.append(page);

  const again = () => {
    const b = button("Check again", { size: "sm" });
    b.addEventListener("click", load);
    return b;
  };

  async function load() {
    page.replaceChildren(head(hash, undefined, undefined, false, null), skeleton(1, 120), skeleton(8, 44));
    let st: ReceiptStatus;
    try {
      st = await deps.status(hash);
    } catch (e) {
      const code = httpStatus(e);
      page.replaceChildren(head(hash, undefined, false, false, null));
      if (code === 404 || code === 400) {
        page.append(emptyState({ title: "This host doesn't know that receipt", text: "It may come from another host, or the host's store was reset. Paste the receipt on Verify to check it against any host.", tone: "coral", action: link("Open Verify", "#verify", "btn btn-secondary") }));
      } else {
        page.append(banner("coral", `Couldn't reach the host (${errorText(e)}).`, again()));
      }
      return;
    }
    if (st.status === "pending") return pending();
    return anchored(st);
  }

  async function pending() {
    const held = heldReceipt(hash);
    page.replaceChildren(head(hash, held?.body, false, false, held ? actions(hash, held, {}) : null), levelLadder([false, false]), banner("sky", "Waiting for batch. The host anchors receipts in batches; this one isn't onchain yet.", again()));
    if (!held) return;
    const jwks = await deps.jwks().catch(() => ({ keys: [] }));
    const result = await verifyReceipt({ ...held, jwks });
    page.append(h("div", { class: "receipt-grid" }, h("div", { class: "col" }, bodyCard(held.body), rawCard(held.body)), h("div", { class: "col" }, card("Checks", "Run in your browser", renderChecks(result)), limits())));
  }

  async function anchored(st: Extract<ReceiptStatus, { status: "anchored" }>) {
    const { body, jws, root: batchRoot, proof, anchorTx } = st;
    const agentId = parseAgentId(body.host.agentId);
    const jwks = await deps.jwks().catch(() => ({ keys: [] }));
    const result = await verifyReceipt({ body, jws, jwks, proof, root: batchRoot, onchain: { client: deps.client, anchor: RECEIPT_ANCHOR } });
    const isAnchored = result.checks.anchored === "pass";
    const ladder = h("div", {}, levelLadder([isAnchored, false]));
    const anchorSlot = h("div", {}, skeleton(1, 220));
    const cosignSlot = h("div", {}, skeleton(1, 120));
    const gradeSlot = h("div", {}, skeleton(1, 140));
    page.replaceChildren(
      head(hash, body, isAnchored, result.checks.cosigned === "pass", actions(hash, { body, jws }, { root: batchRoot, proof, anchorTx })),
      h("div", { class: "ladder-head" }, h("h2", {}, "How far this receipt was checked"), h("span", { class: "hint" }, "Levels 2 and 3 are on the roadmap, not built")),
      ladder,
      h(
        "div",
        { class: "receipt-grid" },
        h("div", { class: "col" }, bodyCard(body), cosignSlot, rawCard(body)),
        h("div", { class: "col" }, card("Checks", "Run in your browser", renderChecks(result)), anchorSlot, gradeSlot, limits()),
      ),
    );

    const info = await deps.anchor({ agentId, root: batchRoot, receiptHash: hash, anchorTx }).catch(() => null);
    anchorSlot.replaceChildren(info ? renderAnchorCard(info, batchRoot, st.reproduce?.cast) : banner("coral", "Couldn't read the batch from the indexer or the chain.", again()));
    cosignSlot.replaceChildren(cosignCard(body, info));

    const trusted = loadTrusted();
    if (!trusted.length) return gradeSlot.replaceChildren(gradeCard(body, undefined, "unknown"));
    try {
      const found = await deps.grade(modelKey(body.model), hostKeyForAgent(CHAIN_ID, agentId), trusted);
      const status = gradeStatus(found?.grade, { now: BigInt(Math.floor(Date.now() / 1000)) });
      gradeSlot.replaceChildren(gradeCard(body, found, status));
      ladder.replaceChildren(levelLadder([isAnchored, !!found && status !== "unknown"]));
    } catch (e) {
      gradeSlot.replaceChildren(gradeCard(body, null, "unknown", errorText(e)));
    }
  }

  void load();
}
