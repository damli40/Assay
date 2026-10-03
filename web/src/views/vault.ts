import { cosignerForAddress, receiptHash } from "@assay/receipts";
import { recoverMessageAddress, type Hex } from "viem";
import { copyButton, errorText, field, h, input, liveRegion, mono, section, textarea } from "../dom.js";
import { addToVault, createVaultPasskey, loadSealed, meraCredential, meraMessage, storeSealed, unlockVault, withPrf } from "../mera.js";
import { parseReceipt, parseSalt, rememberReceipt, toBase64url } from "../lib/receipt.js";
import {
  openDisclosure,
  requesterAddress,
  requesterLabel,
  revealKey,
  revealLabel,
  sealDisclosure,
  signReceiptHash,
  type Disclosure,
  type Sealed,
  type VaultEntry,
} from "../lib/vault.js";

function passkeyCard() {
  const status = liveRegion();
  const info = h("p", { class: "hint" });
  const show = () => (info.textContent = meraCredential() ? "This browser remembers a vault passkey. Any synced copy of it works on other devices." : "No vault passkey remembered here. Create one, or unlock with an existing synced passkey.");
  show();
  const create = h("button", { type: "button", class: "secondary" }, "Create a vault passkey");
  create.addEventListener("click", async () => {
    try {
      status.say("Waiting for the passkey prompt…");
      await createVaultPasskey();
      show();
      status.say("Vault passkey created.", "ok");
    } catch (e) {
      status.say(meraMessage(e), "error");
    }
  });
  return h("div", { class: "card" }, h("h2", {}, "Passkey"), info, create, status.el);
}

function vaultCard() {
  // Plaintext lives only in this closure while unlocked; Lock and navigation drop it.
  let entries: VaultEntry[] | null = null;
  const status = liveRegion();
  const list = h("div");
  const share = h("div");

  const render = () => {
    share.replaceChildren();
    if (!entries) return list.replaceChildren(h("p", { class: "hint" }, loadSealed() ? "Locked. The ciphertext is in this browser." : "Empty. Save a receipt from Ask, add one below, or import a vault."));
    if (entries.length === 0) return list.replaceChildren(h("p", { class: "hint" }, "Unlocked, no receipts yet."));
    const ul = h("ul", { class: "entries" });
    for (const e of entries) {
      const btn = h("button", { type: "button", class: "secondary" }, "Share this receipt");
      btn.addEventListener("click", () => disclose(e));
      rememberReceipt(e.receiptHash, { body: e.body, jws: e.jws });
      const verifyCopy = toBase64url(JSON.stringify({ body: e.body, jws: e.jws }));
      ul.append(
        h("li", {}, mono(e.receiptHash), h("span", { class: "hint" }, ` ${e.body.model} · ${new Date(e.savedAt).toISOString()}`), h("div", { class: "row" }, copyButton(verifyCopy, "Copy receipt"), copyButton(e.salt, "Copy salt"), btn)),
      );
    }
    list.replaceChildren(ul);
  };

  async function disclose(e: VaultEntry) {
    try {
      status.say("Waiting for the passkey prompt for this receipt's reveal key…");
      const key = await withPrf(revealLabel(e.receiptHash), (prf) => revealKey(prf, e.receiptHash));
      const blob = JSON.stringify(await sealDisclosure(key, e));
      share.replaceChildren(
        h("h3", {}, "Disclosure for one receipt"),
        h("p", { class: "hint" }, "Send both to the person who should see this receipt. The key opens this entry only, never the rest of the vault."),
        h("pre", {}, blob),
        copyButton(blob, "Copy disclosure"),
        " ",
        copyButton(key, "Copy key"),
      );
      status.say("Disclosure ready.", "ok");
    } catch (err) {
      status.say(meraMessage(err), "error");
    }
  }

  const unlock = h("button", { type: "button" }, "Unlock");
  unlock.addEventListener("click", async () => {
    try {
      status.say("Waiting for the passkey prompt…");
      entries = await unlockVault();
      render();
      status.say(`Unlocked: ${entries.length} receipt(s).`, "ok");
    } catch (e) {
      status.say(meraMessage(e), "error");
    }
  });
  const lock = h("button", { type: "button", class: "secondary" }, "Lock");
  lock.addEventListener("click", () => {
    entries = null;
    render();
    status.say("Locked.");
  });

  const receipt = field("Receipt", textarea({ rows: "3" }));
  const salt = field("Salt", input(""));
  const output = field("Output text (optional)", textarea({ rows: "2" }));
  const add = h("form", { class: "sub" }, h("h3", {}, "Add a receipt"), receipt.row, salt.row, output.row, h("button", { type: "submit" }, "Encrypt and add"));
  add.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try {
      const held = parseReceipt(receipt.input.value);
      const entry: VaultEntry = { receiptHash: receiptHash(held.body), ...held, salt: parseSalt(salt.input.value), savedAt: Date.now() };
      if (output.input.value !== "") entry.output = output.input.value;
      status.say("Waiting for the passkey prompt…");
      entries = await addToVault(entry);
      render();
      add.reset();
      status.say("Added.", "ok");
    } catch (e) {
      status.say(meraMessage(e), "error");
    }
  });

  const blob = field("Vault ciphertext", textarea({ rows: "2" }), "Copy it to another device, paste it there, and unlock with the same synced passkey.");
  const copyOut = h("button", { type: "button", class: "secondary" }, "Show this browser's ciphertext");
  copyOut.addEventListener("click", () => (blob.input.value = JSON.stringify(loadSealed() ?? "")));
  const importBtn = h("button", { type: "button", class: "secondary" }, "Replace with pasted ciphertext");
  importBtn.addEventListener("click", () => {
    try {
      const s = JSON.parse(blob.input.value) as Sealed;
      if (typeof s?.iv !== "string" || typeof s?.ct !== "string") throw new Error("Not a vault ciphertext.");
      storeSealed(s);
      entries = null;
      render();
      status.say("Imported. Unlock to read it.", "ok");
    } catch (e) {
      status.say(errorText(e), "error");
    }
  });

  render();
  return h(
    "div",
    { class: "card" },
    h("h2", {}, "Receipt vault"),
    h("p", { class: "hint" }, "Namespace assay:vault:v1. PRF output, then HKDF, then an AES-256-GCM key. Only ciphertext is stored."),
    h("div", { class: "row" }, unlock, lock),
    status.el,
    list,
    share,
    add,
    h("details", {}, h("summary", {}, "Move the vault to another device"), blob.row, h("div", { class: "row" }, copyOut, importBtn)),
  );
}

function revealCard() {
  const status = liveRegion();
  const blob = field("Disclosure", textarea({ rows: "3" }));
  const key = field("Key", input("", { placeholder: "0x…" }));
  const out = h("div");
  const form = h("form", { class: "card" }, h("h2", {}, "Open a disclosure"), h("p", { class: "hint" }, "Namespace assay:reveal:<receiptHash>. No passkey needed on this side."), blob.row, key.row, h("button", { type: "submit" }, "Open"), status.el, out);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    out.replaceChildren();
    try {
      const d = JSON.parse(blob.input.value) as Disclosure;
      const e = await openDisclosure(key.input.value.trim() as Hex, d);
      const receipt = toBase64url(JSON.stringify({ body: e.body, jws: e.jws }));
      out.append(
        h("dl", { class: "kv" },
          h("dt", {}, "Receipt hash"), h("dd", {}, mono(e.receiptHash)),
          h("dt", {}, "Salt"), h("dd", {}, mono(e.salt), " ", copyButton(e.salt)),
          h("dt", {}, "Output"), h("dd", {}, e.output ?? ""),
        ),
        copyButton(receipt, "Copy receipt for Verify"),
      );
      status.say("Opened. Paste the receipt, salt and output on the Verify page to check them.", "ok");
    } catch (e) {
      status.say(errorText(e), "error");
    }
  });
  return form;
}

function requesterCard() {
  const status = liveRegion();
  const apps = [field("App id A", input("chat.example")), field("App id B", input("code.example"))];
  const outs = apps.map(() => h("dd", {}, "not derived"));
  const derive = h("button", { type: "button" }, "Derive both addresses");
  derive.addEventListener("click", async () => {
    try {
      for (const [i, app] of apps.entries()) {
        status.say(`Passkey prompt ${i + 1} of 2…`);
        const addr = await withPrf(requesterLabel(app.input.value.trim()), requesterAddress);
        outs[i].replaceChildren(mono(addr));
      }
      status.say("Two apps, two unrelated addresses, one passkey.", "ok");
    } catch (e) {
      status.say(meraMessage(e), "error");
    }
  });

  const hash = field("Receipt hash to sign as app A", input("", { placeholder: "0x + 64 hex" }));
  const sigOut = h("div");
  const sign = h("button", { type: "button", class: "secondary" }, "Sign for cosignK");
  sign.addEventListener("click", async () => {
    sigOut.replaceChildren();
    try {
      const rh = hash.input.value.trim() as Hex;
      if (!/^0x[0-9a-fA-F]{64}$/.test(rh)) throw new Error("Receipt hash must be 0x + 64 hex.");
      status.say("Waiting for the passkey prompt…");
      const { address, signature } = await withPrf(requesterLabel(apps[0].input.value.trim()), (prf) => signReceiptHash(prf, rh));
      const recovered = await recoverMessageAddress({ message: { raw: rh }, signature });
      sigOut.append(
        h("dl", { class: "kv" },
          h("dt", {}, "Signer"), h("dd", {}, mono(address)),
          h("dt", {}, "X-Assay-Cosigner"), h("dd", {}, mono(cosignerForAddress(address)), " ", copyButton(cosignerForAddress(address))),
          h("dt", {}, "Signature"), h("dd", {}, mono(signature), " ", copyButton(signature)),
          h("dt", {}, "ecrecover"), h("dd", {}, recovered === address ? "recovers to the signer" : "MISMATCH"),
        ),
      );
      status.say("Signed. The key existed only for this one signature.", "ok");
    } catch (e) {
      status.say(meraMessage(e), "error");
    }
  });

  return h(
    "div",
    { class: "card" },
    h("h2", {}, "Per-app requester identity"),
    h("p", { class: "hint" }, "Namespace assay:requester:<appId>. PRF output, then BIP-39 and BIP-32 m/44'/60'/0'/0/0, a secp256k1 key per app. Apps can't link your activity through one public key."),
    apps[0].row,
    apps[1].row,
    derive,
    h("dl", { class: "kv" }, h("dt", {}, "App A"), outs[0], h("dt", {}, "App B"), outs[1]),
    hash.row,
    sign,
    status.el,
    sigOut,
  );
}

export function mountVault(root: HTMLElement) {
  root.append(
    section(
      "Vault",
      "One passkey, three separate keys. Each comes from the passkey's PRF output with its own salt, sha256 of the label, and none is ever stored.",
      passkeyCard(),
      vaultCard(),
      requesterCard(),
      revealCard(),
    ),
  );
}
