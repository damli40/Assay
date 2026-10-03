import { h, shortHash } from "../dom.js";
import { CRE_ATTESTOR, EXPLORER, RECEIPT_ANCHOR, VERIFIER_REGISTRY } from "../lib/config.js";

// Footer addresses come from config, so they're never typed twice.
const addr = document.getElementById("l-addr")!;
for (const [name, a] of [["ReceiptAnchor", RECEIPT_ANCHOR], ["VerifierRegistry", VERIFIER_REGISTRY], ["CreAttestor", CRE_ATTESTOR]] as const) {
  const short = shortHash(a);
  short.textContent = `${a.slice(0, 6)}…${a.slice(-4)}`;
  addr.append(h("dt", {}, name), h("dd", {}, h("a", { href: `${EXPLORER}/address/${a}` }, short)));
}

// Phone menu: a modal sheet. Focus stays inside, Escape closes, focus returns to the button.
const openBtn = document.querySelector<HTMLButtonElement>(".l-navcta .l-menu")!;
const sheet = document.getElementById("l-sheet")!;
const closeBtn = sheet.querySelector<HTMLButtonElement>(".l-close")!;
const focusables = () => [...sheet.querySelectorAll<HTMLElement>("a[href], button")];

function setOpen(open: boolean) {
  sheet.hidden = !open;
  openBtn.setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("l-locked", open);
  (open ? focusables()[0] : openBtn).focus();
}

openBtn.addEventListener("click", () => setOpen(true));
closeBtn.addEventListener("click", () => setOpen(false));
sheet.addEventListener("keydown", (e) => {
  if (e.key === "Escape") return setOpen(false);
  if (e.key !== "Tab") return;
  const list = focusables();
  const first = list[0];
  const last = list[list.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});
// A section link closes the sheet first, then the browser scrolls to the anchor.
for (const a of sheet.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) a.addEventListener("click", () => setOpen(false));
