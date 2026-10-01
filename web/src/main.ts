import "./style.css";
import { mountAsk } from "./views/ask.js";
import { mountGrades } from "./views/grades.js";
import { mountVault } from "./views/vault.js";
import { mountVerify } from "./views/verify.js";

const routes: Record<string, (root: HTMLElement) => void> = { verify: mountVerify, ask: mountAsk, grades: mountGrades, vault: mountVault };
const main = document.getElementById("main")!;

function route(focus: boolean) {
  const name = location.hash.slice(1) in routes ? location.hash.slice(1) : "verify";
  main.replaceChildren();
  routes[name](main);
  for (const a of document.querySelectorAll<HTMLAnchorElement>("nav a")) {
    if (a.hash === `#${name}`) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  // Move focus to the new page so keyboard and screen reader users land on it.
  if (focus) main.focus();
}

addEventListener("hashchange", () => route(true));
route(false);
