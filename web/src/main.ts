import { emptyState, h, section, setPageTab } from "./dom.js";
import { DOCS_URL } from "./lib/config.js";
import { match, parseHash, tabOf, type Route } from "./router.js";
import { mountAsk } from "./views/ask.js";
import { mountGrades } from "./views/grades.js";
import { mountReceipt } from "./views/receipt.js";
import { mountVault } from "./views/vault.js";
import { mountVerify } from "./views/verify.js";

const VIEWS = { verify: mountVerify, ask: mountAsk, grades: mountGrades, vault: mountVault };
const TAB_NAMES: Record<string, string> = { verify: "Verify", ask: "Ask", grades: "Grades", hosts: "Hosts", vault: "Vault", developers: "Developers" };
const main = document.getElementById("main")!;

function link(label: string, href: string, variant: "primary" | "secondary") {
  return h("a", { class: `btn btn-${variant}`, href }, label);
}

function notFound(root: HTMLElement, route: Route) {
  root.append(
    section(
      "That page isn't here",
      route.path[0] === "r" ? "A receipt hash is 0x followed by 64 hex characters." : "The link may be old, or the route moved.",
      h("div", { class: "row" }, link("Verify a receipt", "#verify", "primary"), link("Docs", DOCS_URL, "secondary")),
    ),
  );
}

function planned(root: HTMLElement, title: string, step: number) {
  // Dev builds name the build step; the deployed site just says the page isn't live yet.
  const text = import.meta.env.DEV ? `Coming in step ${step}.` : "This page isn't live yet. Receipts can be verified today.";
  root.append(section(title, "", emptyState({ title: `${title} is on its way`, text, tone: "sky", action: link("Verify a receipt", "#verify", "secondary") })));
}

function render(route: Route, focus: boolean) {
  const m = match(route);
  const tab = m.view === "notFound" ? "" : tabOf(route);
  setPageTab(TAB_NAMES[tab] ?? "");
  main.replaceChildren();
  if (m.view === "notFound") notFound(main, route);
  else if (m.view === "planned") planned(main, m.title, m.step);
  else if (m.view === "receipt") mountReceipt(main, route);
  else VIEWS[m.view](main);
  for (const a of document.querySelectorAll<HTMLAnchorElement>("[data-tab]")) {
    if (a.dataset.tab === tab) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  // Move focus to the new page so keyboard and screen reader users land on it.
  if (focus) main.focus();
}

addEventListener("hashchange", () => render(parseHash(location.hash), true));
render(parseHash(location.hash), false);
