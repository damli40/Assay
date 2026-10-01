import { checkOrigin, cosignReceipt, registerPasskey, wrap, type Passkey, type WrappedResult } from "@assay/receipts";
import { copyButton, errorText, field, h, input, liveRegion, mono, section, textarea } from "../dom.js";
import { addToVault, meraMessage } from "../mera.js";
import { DEFAULT_HOST, EXPLORER } from "../lib/config.js";
import { fetchReceiptStatus, hostUrl, relayCosign } from "../lib/host.js";
import { toBase64url } from "../lib/receipt.js";

// Public key material only (credential id, qx, qy, key hash).
const PASSKEY = "assay.passkey";
const POLL_MS = 5000;
const POLL_LIMIT_MS = 15 * 60 * 1000;

const loadPasskey = (): Passkey | null => {
  const raw = localStorage.getItem(PASSKEY);
  return raw ? (JSON.parse(raw) as Passkey) : null;
};

const txLink = (hash: string) => h("a", { href: `${EXPLORER}/tx/${hash}`, target: "_blank", rel: "noopener" }, `${hash.slice(0, 10)}…${hash.slice(-8)}`);

export function mountAsk(root: HTMLElement) {
  let passkey = loadPasskey();
  const pkStatus = liveRegion();
  const pkInfo = h("div");
  const showPasskey = () =>
    pkInfo.replaceChildren(
      passkey
        ? h("p", {}, "Co-signer key hash ", mono(passkey.keyHash), " ", copyButton(passkey.keyHash))
        : h("p", { class: "hint" }, "No passkey yet. Without one you can still ask, but you can't co-sign."),
    );
  showPasskey();
  const register = h("button", { type: "button" }, "Register a passkey");
  register.addEventListener("click", async () => {
    try {
      pkStatus.say("Waiting for the passkey prompt…");
      passkey = await registerPasskey({ rpId: location.hostname, userName: "Assay requester" });
      localStorage.setItem(PASSKEY, JSON.stringify(passkey));
      showPasskey();
      pkStatus.say("Passkey registered.", "ok");
    } catch (e) {
      pkStatus.say(errorText(e), "error");
    }
  });

  const host = field("Host base URL", input(DEFAULT_HOST));
  const question = field("Question", textarea({ rows: "3", required: true }));
  const status = liveRegion();
  const answer = h("div");
  const form = h("form", { class: "card" }, question.row, h("details", {}, h("summary", {}, "Host"), host.row), h("button", { type: "submit" }, "Ask"), status.el);

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    answer.replaceChildren();
    const base = host.input.value;
    const messages = [{ role: "user", content: question.input.value }];
    try {
      status.say("Asking the host…");
      const ask = wrap(fetch.bind(globalThis), passkey ? { cosigner: passkey.keyHash } : {});
      const r = await ask(hostUrl(base, "/v1/chat/completions"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      if (!r.response.ok) throw new Error(`Host answered HTTP ${r.response.status}`);
      answer.append(renderAnswer(r, base, messages));
      status.say("Answer received with a signed receipt.", "ok");
    } catch (e) {
      status.say(errorText(e), "error");
    }
  });

  function renderAnswer(r: WrappedResult, base: string, messages: unknown) {
    const text = (r.json as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? "";
    const header = toBase64url(JSON.stringify({ body: r.receipt.body, jws: r.receipt.jws }));
    const anchorStatus = liveRegion();
    const cosignStatus = liveRegion();
    const cosignBtn = h("button", { type: "button", disabled: true }, "Co-sign with passkey");
    const saveBtn = h("button", { type: "button", class: "secondary" }, "Save to vault");
    const vaultStatus = liveRegion();
    const hash = r.receipt.hash;

    saveBtn.addEventListener("click", async () => {
      try {
        vaultStatus.say("Waiting for the passkey prompt…");
        const all = await addToVault({ receiptHash: hash, body: r.receipt.body, jws: r.receipt.jws, salt: r.salt, output: text, messages, savedAt: Date.now() });
        vaultStatus.say(`Saved, encrypted. The vault holds ${all.length} receipt(s).`, "ok");
      } catch (e) {
        vaultStatus.say(meraMessage(e), "error");
      }
    });

    cosignBtn.addEventListener("click", async () => {
      if (!passkey) return;
      try {
        cosignStatus.say("Waiting for the passkey prompt…");
        const auth = await cosignReceipt(hash, { rpId: location.hostname, credentialId: passkey.credentialId });
        // The contract skips the origin check, so do it here.
        if (!checkOrigin(auth.clientDataJSON, location.origin)) throw new Error("Assertion origin does not match this page.");
        cosignStatus.say("Relaying the co-signature…");
        const { txHash } = await relayCosign(base, hash, passkey.qx, passkey.qy, auth);
        cosignStatus.say("Co-signed onchain.", "ok");
        cosignStatus.el.append(" ", txLink(txHash));
      } catch (e) {
        cosignStatus.say(errorText(e), "error");
      }
    });


    const card = h(
      "div",
      { class: "card" },
      h("h2", {}, "Answer"),
      h("p", { class: "answer" }, text),
      h("p", {}, r.outputCommitOk ? "The output commit matches the bytes you received." : "Warning: the output commit does not match the bytes you received."),
      h("dl", { class: "kv" },
        h("dt", {}, "Receipt hash"), h("dd", {}, mono(hash), " ", copyButton(hash)),
        h("dt", {}, "Salt"), h("dd", {}, mono(r.salt), " ", copyButton(r.salt)),
        h("dt", {}, "Receipt"), h("dd", {}, copyButton(header, "Copy receipt for Verify")),
      ),
      h("p", { class: "hint" }, "Keep the salt. It is the only way to prove later that this output answered this prompt. The vault keeps it encrypted under your passkey."),
      h("div", { class: "row" }, saveBtn, cosignBtn),
      vaultStatus.el,
      anchorStatus.el,
      cosignStatus.el,
    );

    void (async () => {
      const started = Date.now();
      while (Date.now() - started < POLL_LIMIT_MS) {
        try {
          const st = await fetchReceiptStatus(base, hash);
          if (st.status === "anchored") {
            anchorStatus.say("Anchored onchain.", "ok");
            if (st.anchorTx) anchorStatus.el.append(" ", txLink(st.anchorTx));
            if (passkey && r.receipt.body.req.cosigner === passkey.keyHash) cosignBtn.disabled = false;
            else cosignStatus.say("This receipt names no co-signer from this browser, so it can't be co-signed here.");
            return;
          }
          anchorStatus.say("Waiting for the host's next batch to be anchored…");
        } catch (e) {
          anchorStatus.say(`Could not check anchoring: ${errorText(e)}`, "error");
        }
        await new Promise((res) => setTimeout(res, POLL_MS));
        if (!card.isConnected) return;
      }
      anchorStatus.say("Not anchored after 15 minutes. Check again later on the Verify page.", "error");
    })();
    return card;
  }

  root.append(
    section(
      "Ask and co-sign",
      "Ask through an Assay host. The host signs a receipt naming your passkey as co-signer. Once the batch is anchored, co-sign it so the chain records that you asked.",
      h("div", { class: "card" }, h("h2", {}, "Your passkey"), pkInfo, register, pkStatus.el),
      form,
      answer,
    ),
  );
}
