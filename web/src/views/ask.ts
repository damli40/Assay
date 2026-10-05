import { checkOrigin, cosignReceipt, registerPasskey, wrap, type Passkey, type ReceiptBody, type WrappedResult } from "@assay/receipts";
import type { Hex } from "viem";
import { banner, button, chip, confirmDialog, copyButton, emptyState, errorText, field, h, kv, liveRegion, section, skeleton, textarea, input, toast } from "../dom.js";
import { addToVault, meraMessage } from "../mera.js";
import { CHAIN_ID, chainConfig, DEFAULT_HOST, EXPLORER } from "../lib/config.js";
import { fetchHealth, fetchReceiptStatus, httpStatus, hostUrl, relayCosign, type ReceiptStatus } from "../lib/host.js";
import { rememberReceipt, toBase64url } from "../lib/receipt.js";
import { reducedMotion, typewrite } from "../ui/motion.js";
import { batchEta, createTracker, fmtClock } from "../ui/tracker.js";

// Public key material only (credential id, qx, qy, key hash).
const PASSKEY = "assay.passkey";
const POLL_MS = 5000;
const POLL_FAST_MS = 2000;
const POLL_BACKOFF_MAX_MS = 20_000;
const POLL_LIMIT_MS = 15 * 60 * 1000;

const loadPasskey = (): Passkey | null => {
  try {
    const raw = localStorage.getItem(PASSKEY);
    return raw ? (JSON.parse(raw) as Passkey) : null;
  } catch {
    return null;
  }
};

const txLink = (hash: string) => h("a", { href: `${EXPLORER}/tx/${hash}`, target: "_blank", rel: "noopener" }, `${hash.slice(0, 10)}…${hash.slice(-8)}`);

/// Gemma wraps its reasoning in <thought>…</thought>. Hide it on screen; the signed output still includes it.
export function answerText(raw: string): { shown: string; thought: string | null } {
  const m = /^\s*<thought>([\s\S]*?)<\/thought>/.exec(raw);
  return m ? { shown: raw.slice(m[0].length).trim(), thought: m[1].trim() } : { shown: raw, thought: null };
}

/// Options for wrap(): name the passkey as co-signer unless the user chose to send without one.
export const wrapOptions = (passkey: Passkey | null, withoutPasskey: boolean) => (passkey && !withoutPasskey ? { cosigner: passkey.keyHash } : {});

/// The bundle a user keeps: everything needed to verify the commits later, plus the proof once anchored.
export function bundleOf(r: { receipt: { body: ReceiptBody; jws: string }; salt: Hex }, output: string, messages: unknown, anchored?: { root: Hex; proof: Hex[] }) {
  return { body: r.receipt.body, jws: r.receipt.jws, salt: r.salt, output, messages, ...(anchored ? { root: anchored.root, proof: anchored.proof } : {}) };
}

/// Co-signing needs the batch on chain, and the receipt must name this browser's passkey.
export const canCosign = (st: ReceiptStatus | undefined, body: ReceiptBody, passkey: Passkey | null) =>
  st?.status === "anchored" && !!passkey && body.req.cosigner === passkey.keyHash;

/// "every 2 minutes" for a BATCH_SECONDS value.
export const batchEvery = (seconds: number) =>
  seconds === 60 ? "every minute" : seconds % 60 === 0 ? `every ${seconds / 60} minutes` : `every ${seconds} seconds`;

/// fetch for wrap(): a host error becomes an Error with the host's own message and the HTTP status,
/// before wrap() goes looking for a receipt header the error response never has.
export const strictFetch =
  (f: typeof fetch): typeof fetch =>
  async (input, init) => {
    const res = await f(input, init);
    if (!res.ok) {
      const j = (await res
        .clone()
        .json()
        .catch(() => ({}))) as { error?: { message?: string } };
      throw Object.assign(new Error(j.error?.message ?? `HTTP ${res.status}`), { status: res.status });
    }
    return res;
  };

const sentence = (s: string) => (s ? s[0].toUpperCase() + s.slice(1).replace(/\.?$/, ".") : s);

/// Plain words for a failed Ask.
export function askErrorText(e: unknown): string {
  const code = httpStatus(e);
  const msg = errorText(e);
  if (code === 429) return `${sentence(msg)} Try again later.`;
  if (code !== undefined && code >= 500) return `The host couldn't answer (HTTP ${code}). Try again in a moment.`;
  if (code === undefined && /fetch|network|load failed/i.test(msg)) return "Couldn't reach the host. Check your connection and try again.";
  return sentence(msg);
}

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  h("a", { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function mountAsk(root: HTMLElement) {
  const chain = chainConfig(CHAIN_ID);
  let passkey = loadPasskey();
  const pkStatus = liveRegion();
  const pkInfo = h("div");
  const without = h("input", { type: "checkbox", id: "ask-without" });
  without.checked = !passkey;
  const showPasskey = () =>
    pkInfo.replaceChildren(
      passkey
        ? kv([["Co-signer key", passkey.keyHash]])
        : h("p", { class: "hint" }, "No passkey yet. Without one you can still ask, but you can't co-sign."),
    );
  showPasskey();
  const register = button(passkey ? "Register a new passkey" : "Register a passkey", { size: "sm" });
  register.addEventListener("click", async () => {
    if (passkey) {
      const go = await confirmDialog({
        title: "Register a new passkey?",
        body: "Receipts that already name your current key can only be co-signed with that key. New receipts will name the new one.",
        confirm: "Register new passkey",
      });
      if (!go) return;
    }
    try {
      pkStatus.say("Waiting for the passkey prompt…", "pending");
      passkey = await registerPasskey({ rpId: location.hostname, userName: "Assay requester" });
      localStorage.setItem(PASSKEY, JSON.stringify(passkey));
      without.checked = false;
      register.textContent = "Register a new passkey";
      showPasskey();
      pkStatus.say("Passkey registered.", "ok");
    } catch (e) {
      pkStatus.say(errorText(e), "error");
    }
  });

  const host = field("Host base URL", input(DEFAULT_HOST));
  const question = field("Question", textarea({ rows: "3", required: true, placeholder: "Ask anything. The answer comes back with a signed receipt." }));
  const status = liveRegion();
  const idle = () =>
    emptyState({
      title: "Your answer and its receipt appear here",
      text: `Every answer comes back with a receipt the host signed. ${chain.name} anchors a batch ${batchEvery(chain.batchSeconds)}, and you can follow each step here.`,
      tone: "gold",
    });
  const answer = h("div", { class: "ask-result" }, idle());
  const examples = h(
    "div",
    { class: "row examples" },
    ...["Name one planet.", "Explain a Merkle tree in one sentence.", "What is the capital of Australia?"].map((q) => {
      const b = button(q, { variant: "ghost", size: "sm" });
      b.addEventListener("click", () => {
        question.input.value = q;
        question.input.focus();
      });
      return b;
    }),
  );
  const ask = button("Ask", { variant: "primary", type: "submit" });
  const form = h(
    "form",
    { class: "card ask-form" },
    h("h2", {}, "Ask"),
    question.row,
    examples,
    h("details", {}, h("summary", {}, "Host"), host.row),
    h("div", { class: "row" }, ask),
    status.el,
  );

  const passkeyCard = h(
    "section",
    { class: "card ask-passkey" },
    h("div", { class: "card-head" }, h("h2", {}, "Your passkey"), chip("Optional", "pink")),
    pkInfo,
    h("div", { class: "check-row" }, without, h("label", { for: "ask-without" }, "Send without a passkey. The receipt is still signed and anchored, but nobody can co-sign it later.")),
    h("div", { class: "row" }, register),
    h("p", { class: "hint" }, `Passkeys are bound to ${location.hostname}. One made on another domain won't work here.`),
    pkStatus.el,
  );

  let stopFlow: (() => void) | undefined;
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    stopFlow?.();
    const base = host.input.value;
    const messages = [{ role: "user", content: question.input.value }];
    const opts = wrapOptions(passkey, without.checked);
    const f = flow(base, question.input.value, messages, !!opts.cosigner, () => form.requestSubmit());
    stopFlow = f.stop;
    answer.replaceChildren(f.el);
    // On one column the result sits under the form: bring it into view.
    if (typeof matchMedia === "function" && matchMedia("(max-width: 900px)").matches) {
      f.el.scrollIntoView?.({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
      f.heading.focus({ preventScroll: true });
    }
    ask.disabled = true;
    ask.setAttribute("aria-busy", "true");
    status.say("Asking the host…", "pending");
    try {
      const r = await wrap(strictFetch(fetch.bind(globalThis)), opts)(hostUrl(base, "/v1/chat/completions"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      f.signed(r);
      status.say("Answer received with a signed receipt.", "ok");
    } catch (e) {
      f.failed(askErrorText(e));
      status.say(askErrorText(e), "error");
    } finally {
      ask.disabled = false;
      ask.removeAttribute("aria-busy");
    }
  });

  /// One question's journey: asked, signed, batched, anchored, and co-signed when a passkey is named.
  function flow(base: string, asked: string, messages: unknown, named: boolean, retry: () => void) {
    const t0 = Date.now();
    let signedAt = 0;
    let anchoredAt = 0;
    let intervalMs = chain.batchSeconds * 1000;
    let nextAt: number | undefined;
    let queue: number | undefined;
    // Until the first poll answers, the countdown has nothing honest to show.
    let synced = false;
    let st: ReceiptStatus | undefined;
    let r: WrappedResult | undefined;
    let output = "";
    let hash: Hex | undefined;
    let stopped = false;

    // Panels: built once, filled in as steps finish, so live parts keep their nodes.
    const askedClock = h("strong", { class: "track-num" }, "0:00");
    const askedPanel = h(
      "div",
      { class: "track-body" },
      h("blockquote", { class: "ask-q" }, asked),
      h("p", { class: "track-lead" }, "Waiting for the host's answer ", askedClock),
      h("p", { class: "hint" }, "Your question went to the host with a fresh salt. The receipt commits to your question with that salt, so only someone holding the salt can later prove what was asked."),
    );
    const signedPanel = h("div", { class: "track-body" }, h("p", { class: "track-lead" }, "The host signs a receipt over commits to your question and its answer. It appears here when the answer arrives."));

    const countNum = h("strong", { class: "track-num track-num-lg" }, fmtClock(intervalMs));
    const countWord = h("span", { class: "track-count-word" }, "until the next batch");
    const barFill = h("span");
    const queueLine = h("p", { class: "hint" });
    const quiet = h("p", { class: "hint track-quiet", role: "status" });
    const late = h("div");
    const everyLine = h("p", { class: "track-lead" });
    const batchedPanel = h("div", { class: "track-body" }, h("p", { class: "track-lead" }, "Once signed, the receipt waits for the host's next batch."));
    const batchedLive = h(
      "div",
      { class: "track-body" },
      h("div", { class: "track-count" }, countNum, countWord),
      h("div", { class: "track-bar", "aria-hidden": "true" }, barFill),
      everyLine,
      queueLine,
      quiet,
      late,
      h("p", { class: "hint" }, "You can close this page. The receipt page and the vault keep what you need to co-sign later."),
    );
    const anchoredPanel = h("div", { class: "track-body" }, h("p", { class: "track-lead" }, "When the batch lands, the transaction appears here with the Merkle proof that places your receipt in it."));

    // Co-sign: same rules as before, now inside its own step.
    const cosignBtn = button("Co-sign with passkey", { variant: "cosign" });
    cosignBtn.disabled = true;
    const cosignReason = h("p", { class: "hint" }, "Co-signing unlocks when the batch is anchored.");
    const cosignStatus = liveRegion();
    const cosignErrors = h("div");
    const cosignPanel = h(
      "div",
      { class: "track-body" },
      h("p", { class: "track-lead" }, "Co-sign with the passkey this receipt names, so the chain records that you were the one who asked."),
      h("div", { class: "row" }, cosignBtn),
      cosignReason,
      cosignErrors,
      cosignStatus.el,
    );

    const steps = [
      { id: "asked", label: "Asked", tone: "bone" as const, state: "now" as const, meta: "0:00", panel: () => askedPanel },
      { id: "signed", label: "Signed", tone: "gold" as const, state: "todo" as const, panel: () => signedPanel },
      { id: "batched", label: "Batched", tone: "sky" as const, state: "todo" as const, panel: () => batchedPanel },
      { id: "anchored", label: "Anchored", tone: "violet" as const, state: "todo" as const, panel: () => anchoredPanel },
      ...(named ? [{ id: "cosign", label: "Co-signed", tone: "pink" as const, state: "todo" as const, panel: () => cosignPanel }] : []),
    ];
    const track = createTracker(steps, { label: "Where your receipt is" });

    const heading = h("h2", { tabindex: "-1" }, "Your receipt");
    const answerSlot = h("div", { class: "ask-answer" }, skeleton(3, 14));
    const actions = h("div", { class: "row ask-actions", hidden: true });
    const vaultStatus = liveRegion();
    const noCosign = named ? null : h("p", { class: "hint" }, "This receipt names no passkey, so nobody can co-sign it. Register a passkey to co-sign your next one.");
    const el = h(
      "section",
      { class: "card ask-flow", "aria-labelledby": "ask-flow-title" },
      h("div", { class: "card-head" }, heading, chip(chain.name, CHAIN_ID === 143 ? "violet" : "sky", { dot: true })),
      answerSlot,
      track.el,
      noCosign,
      actions,
      vaultStatus.el,
    );
    heading.id = "ask-flow-title";

    const tick = () => {
      if (stopped) return;
      if (!el.isConnected && signedAt) return stop();
      const now = Date.now();
      if (!signedAt) {
        const t = fmtClock(now - t0);
        askedClock.textContent = t;
        track.update("asked", { meta: t });
        return;
      }
      if (anchoredAt) return;
      if (!synced) {
        countNum.textContent = "…";
        countWord.textContent = "checking the host's batch clock";
        track.update("batched", { meta: "…" });
        return;
      }
      const eta = batchEta({ signedAt, now, intervalMs, nextAt });
      const t = eta.phase === "counting" ? fmtClock(eta.remaining) : eta.phase === "due" ? "any moment" : fmtClock(now - signedAt);
      countNum.textContent = eta.phase === "counting" ? fmtClock(eta.remaining) : fmtClock(now - signedAt);
      countWord.textContent = eta.phase === "counting" ? "until the next batch" : eta.phase === "due" ? "the batch is landing now" : "waiting, longer than usual";
      barFill.style.transform = `scaleX(${eta.frac})`;
      el.dataset.phase = eta.phase;
      if (eta.phase === "late" && !late.firstChild) late.append(banner("warn", "Taking longer than usual. Receipts stay queued until the host's anchor transaction goes through, so yours isn't lost."));
      track.update("batched", { meta: t });
    };
    const clock = setInterval(tick, 1000);

    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let inflight = false;
    let fails = 0;
    async function poll() {
      clearTimeout(pollTimer);
      if (stopped || !hash || inflight) return;
      if (!el.isConnected) return stop();
      inflight = true;
      const sent = Date.now();
      const [s, hl] = await Promise.allSettled([fetchReceiptStatus(base, hash), fetchHealth(base)]);
      inflight = false;
      if (stopped) return;
      synced = true;
      if (hl.status === "fulfilled") {
        queue = hl.value.pending;
        if (hl.value.batchSeconds) intervalMs = hl.value.batchSeconds * 1000;
        if (typeof hl.value.nextBatchInMs === "number") nextAt = sent + hl.value.nextBatchInMs;
        everyLine.textContent = `${chain.name} anchors a batch ${batchEvery(intervalMs / 1000)}. Every receipt waiting at that moment goes into one Merkle tree, and one transaction puts its root on Monad.`;
        queueLine.textContent = queue ? `${queue} receipt${queue === 1 ? "" : "s"} in the host's queue, yours included.` : "";
      }
      if (s.status === "fulfilled") {
        fails = 0;
        quiet.textContent = "";
        st = s.value;
        if (st.status === "anchored") return onAnchored(st);
        tick();
      } else {
        fails += 1;
        quiet.textContent = "Couldn't reach the host to check. Trying again.";
      }
      if (Date.now() - signedAt > POLL_LIMIT_MS) {
        late.replaceChildren(banner("warn", "Not anchored after 15 minutes. Open the receipt page later to check again."));
        return stop();
      }
      const eta = batchEta({ signedAt, now: Date.now(), intervalMs, nextAt });
      const delay = fails
        ? Math.min(POLL_BACKOFF_MAX_MS, POLL_MS * 2 ** (fails - 1))
        : eta.phase !== "late" && eta.remaining < 10_000
          ? POLL_FAST_MS
          : POLL_MS;
      pollTimer = setTimeout(poll, delay);
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        tick();
        void poll();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    function stop() {
      stopped = true;
      clearInterval(clock);
      clearTimeout(pollTimer);
      document.removeEventListener("visibilitychange", onVisible);
    }

    function signed(res: WrappedResult) {
      r = res;
      hash = res.receipt.hash;
      signedAt = Date.now();
      output = (res.json as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? "";
      const { shown, thought } = answerText(output);
      rememberReceipt(hash, { body: res.receipt.body, jws: res.receipt.jws });
      const agent = res.receipt.body.host.agentId.split(":").pop();

      const p = h("p", { class: "answer" });
      void typewrite(p, shown);
      answerSlot.replaceChildren(p, thought ? h("details", {}, h("summary", {}, "The model's reasoning (part of the signed output)"), h("pre", {}, thought)) : "");

      askedPanel.querySelector(".track-lead")!.replaceChildren(`Answered in ${fmtClock(signedAt - t0, true)}.`);
      signedPanel.replaceChildren(
        h("p", { class: "track-lead" }, `Host ${agent} signed a receipt (${res.receipt.body.host.alg}).`),
        h("p", { class: res.outputCommitOk ? "track-ok" : "track-bad" }, res.outputCommitOk ? "The output commit matches the bytes you received." : "Warning: the output commit does not match the bytes you received."),
        kv([
          ["Receipt hash", hash],
          ["Salt", res.salt],
          ["Model", res.receipt.body.model],
          ["Tokens", `${res.receipt.body.res.tokensIn} in · ${res.receipt.body.res.tokensOut} out`],
        ]),
        h("div", { class: "row" }, copyButton(toBase64url(JSON.stringify({ body: res.receipt.body, jws: res.receipt.jws })), "Copy receipt for Verify")),
        h("p", { class: "hint" }, "Keep the salt. It is the only way to prove later that this output answered this prompt. The vault keeps it encrypted under your passkey."),
      );
      everyLine.textContent = `${chain.name} anchors a batch ${batchEvery(chain.batchSeconds)}. Every receipt waiting at that moment goes into one Merkle tree, and one transaction puts its root on Monad.`;
      batchedPanel.replaceChildren(...batchedLive.childNodes);

      track.update("asked", { state: "done", meta: fmtClock(signedAt - t0, true) });
      track.update("signed", { state: "done", meta: res.receipt.body.host.alg });
      track.update("batched", { state: "now", meta: "…" });
      actions.replaceChildren(...actionButtons(res));
      actions.hidden = false;
      tick();
      void poll();
    }

    function onAnchored(a: Extract<ReceiptStatus, { status: "anchored" }>) {
      anchoredAt = Date.now();
      const waited = fmtClock(anchoredAt - signedAt);
      clearInterval(clock);
      batchedPanel.replaceChildren(h("p", { class: "track-lead" }, `Joined a batch ${waited} after signing.`), queueLine);
      const cast = a.reproduce?.cast;
      anchoredPanel.replaceChildren(
        h("p", { class: "track-lead" }, `Anchored on ${chain.name}.`),
        kv([
          ["Transaction", a.anchorTx ? txLink(a.anchorTx) : "Not reported by the host"],
          ["Batch root", a.root],
          ["Proof", `${a.proof.length} hash${a.proof.length === 1 ? "" : "es"}`],
        ]),
        cast ? h("details", { class: "track-cast" }, h("summary", {}, "Check it yourself with cast"), h("pre", {}, cast), copyButton(cast, "Copy cast command")) : "",
        h("div", { class: "row" }, h("a", { class: "btn btn-primary btn-sm", href: `#r/${hash}` }, "Open receipt page")),
      );
      track.update("batched", { state: "done", meta: waited });
      track.update("anchored", { state: "done", meta: chain.short });
      toast(`Anchored on ${chain.name} · ${waited}`);
      if (named) {
        track.update("cosign", { state: "now", meta: "your turn" });
        if (r && canCosign(a, r.receipt.body, passkey)) {
          cosignBtn.disabled = false;
          cosignReason.textContent = "The batch is anchored. Your passkey will ask for Face ID, a fingerprint or your PIN.";
        } else {
          cosignReason.textContent = "This browser's passkey isn't the one the receipt names, so it can't co-sign here.";
        }
      } else stop();
    }

    function failed(msg: string) {
      clearInterval(clock);
      const again = button("Try again", { size: "sm" });
      again.addEventListener("click", retry);
      answerSlot.replaceChildren();
      noCosign?.remove();
      askedPanel.querySelector(".track-lead")!.replaceChildren(banner("coral", msg, again));
      askedPanel.querySelector(".hint")!.textContent = "Nothing was signed, so this question has no receipt.";
      track.update("asked", { state: "error", meta: "failed" });
      stop();
    }

    cosignBtn.addEventListener("click", async () => {
      if (!passkey || !hash) return;
      cosignErrors.replaceChildren();
      cosignBtn.setAttribute("aria-busy", "true");
      try {
        cosignStatus.say("Waiting for the passkey prompt…", "pending");
        const auth = await cosignReceipt(hash, { rpId: location.hostname, credentialId: passkey.credentialId });
        // The contract skips the origin check, so do it here.
        if (!checkOrigin(auth.clientDataJSON, location.origin)) throw new Error("Assertion origin does not match this page.");
        cosignStatus.say("Relaying the co-signature…", "pending");
        const { txHash } = await relayCosign(base, hash, passkey.qx, passkey.qy, auth);
        cosignStatus.say("Co-signed onchain.", "ok");
        cosignStatus.el.append(" ", txLink(txHash));
        cosignBtn.disabled = true;
        track.update("cosign", { state: "done", meta: "passkey" });
        stop();
      } catch (e) {
        cosignStatus.say("");
        const code = httpStatus(e);
        if (code === 409) cosignErrors.append(banner("warn", "The batch isn't anchored yet. Try again in a moment."));
        else if (code === 429) cosignErrors.append(banner("coral", `${errorText(e)}. Try again later.`));
        else cosignErrors.append(banner("coral", errorText(e)));
      } finally {
        cosignBtn.removeAttribute("aria-busy");
      }
    });

    function actionButtons(res: WrappedResult) {
      const id = res.receipt.hash;
      const saveBtn = button("Save to vault", { size: "sm" });
      saveBtn.addEventListener("click", async () => {
        try {
          vaultStatus.say("Waiting for the passkey prompt…", "pending");
          const all = await addToVault({ receiptHash: id, body: res.receipt.body, jws: res.receipt.jws, salt: res.salt, output, messages, savedAt: Date.now() });
          vaultStatus.say(`Saved, encrypted. The vault holds ${all.length} receipt(s).`, "ok");
        } catch (e) {
          vaultStatus.say(meraMessage(e), "error");
        }
      });
      const bundleBtn = button("Download bundle", { size: "sm" });
      bundleBtn.addEventListener("click", () =>
        download(`assay-receipt-${id.slice(2, 10)}.json`, bundleOf(res, output, messages, st?.status === "anchored" ? { root: st.root, proof: st.proof } : undefined)),
      );
      const linkBtn = button("Copy link", { variant: "ghost", size: "sm" });
      linkBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(`${location.origin}/app/#r/${id}`);
          toast("Receipt link copied");
        } catch {
          linkBtn.textContent = "Copy failed";
        }
      });
      return [h("a", { class: "btn btn-primary btn-sm", href: `#r/${id}` }, "Open receipt page"), saveBtn, bundleBtn, linkBtn];
    }

    tick();
    return { el, heading, signed, failed, stop };
  }

  root.append(
    section(
      "Ask and co-sign",
      `Ask a question through an Assay host. The answer comes back with a receipt the host signed, and ${chain.name} anchors a batch of receipts ${batchEvery(chain.batchSeconds)}. With a passkey, you can co-sign yours too, so the chain records that you were the one who asked.`,
      h("div", { class: "receipt-grid ask-grid ask-layout" }, form, answer, passkeyCard),
    ),
  );
}
