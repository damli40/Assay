// Network switch: a two-option segmented control in the top bar. Mainnet | Testnet.
// - One click, always visible, same on phone and desktop. No native <select>.
// - role="radiogroup": Tab lands on the checked option, arrow keys move, Space or Enter picks.
// - Colour plus a word plus a dot: violet means mainnet (real MON), sky means testnet (free).
// - A page that reads another chain from its link (#grades?chain=10143, a testnet receipt)
//   calls showPageChain(id). The thumb moves there with a dashed edge, so the bar never says
//   "mainnet" while the page shows testnet data. Picking an option sets the remembered default.

import { h } from "../dom.js";
import { CHAINS, CHAIN_ID, setSelectedChainId } from "../lib/config.js";
import { reducedMotion } from "./motion.js";

const ORDER = [143, 10143];
const TONE: Record<number, string> = { 143: "violet", 10143: "sky" };
const NOTE: Record<number, string> = {
  143: "Real MON. The live receipts and grades.",
  10143: "Free. The place to try things.",
};

let group: HTMLElement | null = null;

function setChecked(id: number) {
  if (!group) return;
  group.dataset.chain = String(id);
  for (const b of group.querySelectorAll<HTMLButtonElement>(".net-opt")) {
    const on = Number(b.dataset.chain) === id;
    b.setAttribute("aria-checked", String(on));
    b.tabIndex = on ? 0 : -1;
  }
}

/// Picking a network remembers it, drops the link's query (its ?chain= or a host id like
/// erc8004:143:… would pin the old chain again), and reloads once the thumb has moved,
/// because every view reads its chain when it loads.
function choose(id: number) {
  const linkChain = location.hash.includes("?");
  if (id === CHAIN_ID && !group?.classList.contains("net-override")) return setChecked(id);
  setChecked(id);
  group?.classList.remove("net-override");
  setSelectedChainId(id);
  const go = () => {
    if (linkChain) location.hash = location.hash.split("?")[0];
    location.reload();
  };
  if (reducedMotion()) go();
  else setTimeout(go, 260);
}

export function mountNetworkSwitch(slot: HTMLElement): void {
  const ids = ORDER.filter((id) => CHAINS[id]);
  if (ids.length < 2) return;
  group = h("div", { class: "net", role: "radiogroup", "aria-label": "Network", "data-chain": String(CHAIN_ID) });
  group.append(h("span", { class: "net-thumb", "aria-hidden": "true" }));
  for (const id of ids) {
    const b = h(
      "button",
      { type: "button", role: "radio", class: `net-opt tone-${TONE[id]}`, "data-chain": String(id), "aria-checked": "false", title: `${CHAINS[id].name}, chain ${id}. ${NOTE[id]}` },
      h("span", { class: "net-dot", "aria-hidden": "true" }),
      h("span", { class: "net-label" }, CHAINS[id].short),
    );
    b.addEventListener("click", () => choose(id));
    b.addEventListener("keydown", (e) => {
      const i = ids.indexOf(id);
      const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const next = group!.querySelector<HTMLButtonElement>(`.net-opt[data-chain="${ids[(i + step + ids.length) % ids.length]}"]`)!;
      next.focus();
      next.click();
    });
    group.append(b);
  }
  slot.replaceChildren(group);
  setChecked(CHAIN_ID);
}

/// A page whose data comes from another chain than the remembered default says so here.
export function showPageChain(id: number): void {
  if (!group || !CHAINS[id]) return;
  setChecked(id);
  group.classList.toggle("net-override", id !== CHAIN_ID);
  group.title = id !== CHAIN_ID ? `This page reads ${CHAINS[id].name} from its link. Your default is ${CHAINS[CHAIN_ID].name}.` : "";
  const foot = document.getElementById("network-foot");
  if (foot) foot.textContent = `${CHAINS[id].name}, chain ${id}.`;
}
