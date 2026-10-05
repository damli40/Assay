import { checkOrigin, cosignReceipt, registerPasskey, wrap, type Passkey, type ReceiptBody, type WrappedResult } from "@assay/receipts";
import type { Hex } from "viem";
import { banner, button, chip, confirmDialog, copyButton, emptyState, errorText, field, h, kv, liveRegion, progress, section, stepper, textarea, input, toast, type StepState } from "../dom.js";
import { addToVault, meraMessage } from "../mera.js";
import { DEFAULT_HOST, EXPLORER } from "../lib/config.js";
import { fetchHealth, fetchReceiptStatus, httpStatus, hostUrl, relayCosign, type ReceiptStatus } from "../lib/host.js";
import { rememberReceipt, toBase64url } from "../lib/receipt.js";
import { typewrite } from "../ui/motion.js";

// Public key material only (credential id, qx, qy, key hash).
const PASSKEY = "assay.passkey";
const POLL_MS = 5000;
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
const mmss = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

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

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  h("a", { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function mountAsk(root: HTMLElement) {
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
  const idle = () => emptyState({ title: "Your answer and its receipt appear here", text: "Every answer comes back with a receipt the host signed. A few seconds later it's anchored on Monad, and you can open its receipt page.", tone: "gold" });
  const answer = h("div", { class: "col" }, idle());
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
    { class: "card" },
    h("h2", {}, "Ask"),
    question.row,
    examples,
    h("details", {}, h("summary", {}, "Host"), host.row),
    h("div", { class: "row" }, ask),
    status.el,
  );

  const passkeyCard = h(
    "section",
    { class: "card" },
    h("div", { class: "card-head" }, h("h2", {}, "Your passkey"), chip("Optional", "pink")),
    pkInfo,
    h("div", { class: "check-row" }, without, h("label", { for: "ask-without" }, "Send without a passkey. The receipt is still signed and anchored, but nobody can co-sign it later.")),
    h("div", { class: "row" }, register),
    h("p", { class: "hint" }, `Passkeys are bound to ${location.hostname}. One made on another domain won't work here.`),
    pkStatus.el,
  );

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    answer.replaceChildren();
    const base = host.input.value;
    const messages = [{ role: "user", content: question.input.value }];
    ask.disabled = true;
    try {
      status.say("Asking the host…", "pending");
      const r = await wrap(fetch.bind(globalThis), wrapOptions(passkey, without.checked))(hostUrl(base, "/v1/chat/completions"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      if (!r.response.ok) throw new Error(`Host answered HTTP ${r.response.status}`);
      answer.append(renderAnswer(r, base, messages));
      status.say("Answer received with a signed receipt.", "ok");
    } catch (e) {
      status.say(httpStatus(e) === undefined && /fetch/i.test(errorText(e)) ? "Couldn't reach the host. Try again in a moment." : errorText(e), "error");
    } finally {
      ask.disabled = false;
    }
  });

  function renderAnswer(r: WrappedResult, base: string, messages: unknown) {
    const output = (r.json as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? "";
    const { shown, thought } = answerText(output);
    const hash = r.receipt.hash;
    const named = !!r.receipt.body.req.cosigner;
    rememberReceipt(hash, { body: r.receipt.body, jws: r.receipt.jws });
    let st: ReceiptStatus | undefined;

    // Stepper: named as co-signer (only when it was), signed, waiting, anchored, co-signed.
    const steps = h("div");
    const wait = h("div");
    const drawSteps = (waiting: Node | string | undefined, cosigned: boolean) => {
      const anchored = st?.status === "anchored";
      const s: { label: string; state: StepState; detail?: Node | string }[] = [];
      if (named) s.push({ label: "Passkey named as co-signer", state: "done" });
      s.push({ label: "Signed by the host", state: "done" });
      s.push({ label: "Waiting for batch", state: anchored ? "done" : "now", detail: anchored ? undefined : waiting });
      s.push({ label: "Anchored onchain", state: anchored ? "done" : "todo", detail: anchored && st?.status === "anchored" && st.anchorTx ? txLink(st.anchorTx) : undefined });
      if (named) s.push({ label: "Co-signed by you", state: cosigned ? "done" : anchored ? "now" : "todo" });
      steps.replaceChildren(stepper(s));
    };
    drawSteps("Starting…", false);

    const reasonId = `cosign-why-${hash.slice(2, 10)}`;
    const cosignBtn = button("Co-sign with passkey", { variant: "cosign", describedBy: reasonId });
    cosignBtn.disabled = true;
    const reason = h("p", { class: "hint", id: reasonId }, named ? "Co-signing unlocks when the host anchors this batch." : "This receipt names no co-signer from this browser, so it can't be co-signed here.");
    const cosignStatus = liveRegion();
    const errors = h("div");
    cosignBtn.addEventListener("click", async () => {
      if (!passkey) return;
      errors.replaceChildren();
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
        drawSteps(undefined, true);
      } catch (e) {
        cosignStatus.say("");
        const code = httpStatus(e);
        if (code === 409) errors.append(banner("warn", "The batch isn't anchored yet. Try again in a moment."));
        else if (code === 429) errors.append(banner("coral", `${errorText(e)}. Try again later.`));
        else errors.append(banner("coral", errorText(e)));
      }
    });

    const vaultStatus = liveRegion();
    const saveBtn = button("Save to vault", { size: "sm" });
    saveBtn.addEventListener("click", async () => {
      try {
        vaultStatus.say("Waiting for the passkey prompt…", "pending");
        const all = await addToVault({ receiptHash: hash, body: r.receipt.body, jws: r.receipt.jws, salt: r.salt, output, messages, savedAt: Date.now() });
        vaultStatus.say(`Saved, encrypted. The vault holds ${all.length} receipt(s).`, "ok");
      } catch (e) {
        vaultStatus.say(meraMessage(e), "error");
      }
    });
    const linkBtn = button("Copy receipt link", { size: "sm" });
    linkBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(`${location.origin}/app/#r/${hash}`);
        toast("Receipt link copied");
      } catch {
        linkBtn.textContent = "Copy failed";
      }
    });
    const bundleBtn = button("Download bundle", { size: "sm" });
    bundleBtn.addEventListener("click", () =>
      download(`assay-receipt-${hash.slice(2, 10)}.json`, bundleOf(r, output, messages, st?.status === "anchored" ? { root: st.root, proof: st.proof } : undefined)),
    );

    const card = h(
      "section",
      { class: "card" },
      h("div", { class: "card-head" }, h("h2", {}, "Answer"), chip(`Signed by host ${r.receipt.body.host.agentId.split(":").pop()}`, "gold", { dot: true })),
      (() => {
        const p = h("p", { class: "answer" });
        void typewrite(p, shown);
        return p;
      })(),
      thought ? h("details", {}, h("summary", {}, "The model's reasoning (part of the signed output)"), h("pre", {}, thought)) : null,
      h("p", { class: "hint" }, r.outputCommitOk ? "The output commit matches the bytes you received." : "Warning: the output commit does not match the bytes you received."),
      kv([
        ["Receipt hash", hash],
        ["Salt", r.salt],
        ["Receipt", copyButton(toBase64url(JSON.stringify({ body: r.receipt.body, jws: r.receipt.jws })), "Copy receipt for Verify")],
      ]),
      h("p", { class: "hint" }, "Keep the salt. It is the only way to prove later that this output answered this prompt. The vault keeps it encrypted under your passkey."),
      h("div", { class: "row" }, h("a", { class: "btn btn-primary btn-sm", href: `#r/${hash}` }, "Open receipt page"), linkBtn, bundleBtn, saveBtn),
      vaultStatus.el,
    );
    const where = h(
      "section",
      { class: "card" },
      h("h2", {}, "Where your receipt is"),
      steps,
      wait,
      h("p", { class: "hint" }, "You can close this page. The receipt link and the vault let you co-sign later."),
      h("div", { class: "row" }, cosignBtn),
      reason,
      errors,
      cosignStatus.el,
    );

    void (async () => {
      const started = Date.now();
      while (Date.now() - started < POLL_LIMIT_MS) {
        try {
          st = await fetchReceiptStatus(base, hash);
          if (st.status === "anchored") {
            wait.replaceChildren();
            drawSteps(undefined, false);
            if (canCosign(st, r.receipt.body, passkey)) {
              cosignBtn.disabled = false;
              reason.textContent = "The batch is anchored. Co-sign to record onchain that you asked.";
            }
            return;
          }
          const pending = await fetchHealth(base).then((x) => x.pending).catch(() => undefined);
          const elapsed = Date.now() - started;
          const text = `Waiting ${mmss(elapsed)}${pending === undefined ? "" : ` · ${pending} receipt${pending === 1 ? "" : "s"} in the host's queue`}`;
          drawSteps(text, false);
          wait.replaceChildren(progress({ value: elapsed / 1000, max: POLL_LIMIT_MS / 1000, valueText: text, label: "Time waiting for the batch" }));
        } catch (e) {
          drawSteps(`Could not check anchoring: ${errorText(e)}`, false);
        }
        await new Promise((res) => setTimeout(res, POLL_MS));
        if (!card.isConnected) return;
      }
      drawSteps("Not anchored after 15 minutes. Check again later on the Verify page.", false);
    })();
    return h("div", { class: "col" }, card, where);
  }

  root.append(
    section(
      "Ask and co-sign",
      "Ask a question through an Assay host. The answer comes back with a receipt the host signed, and a few seconds later the batch is anchored on Monad. With a passkey, you can co-sign it too, so the chain records that you were the one who asked.",
      h("div", { class: "receipt-grid ask-grid" }, h("div", { class: "col" }, form, passkeyCard), answer),
    ),
  );
}
