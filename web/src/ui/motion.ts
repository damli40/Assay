// Motion helpers for the Touchstone Glass polish layer.
// Rules (private/ui/POLISH.md):
// - Motion explains a change. It never hides content from someone without JavaScript, and it never blocks input.
// - Every helper sets the final state at once when the reader prefers reduced motion.
// - Calling a helper again on the same element cancels the run in progress. Nothing depends on animationend.

export const reducedMotion = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

let observer: IntersectionObserver | null = null;

/// Fades [data-reveal] elements up as they enter the viewport, once each.
/// Children of [data-reveal-group] get a stagger index (--i). Content stays visible without JS:
/// the hidden start state only applies under html.js-reveal, which this function sets.
export function initReveal(root: ParentNode = document): void {
  for (const group of root.querySelectorAll<HTMLElement>("[data-reveal-group]")) {
    [...group.children].forEach((child, i) => {
      const el = child as HTMLElement;
      if (!el.hasAttribute("data-reveal")) el.setAttribute("data-reveal", "");
      el.style.setProperty("--i", String(Math.min(i, 8)));
    });
  }
  const els = [...root.querySelectorAll<HTMLElement>("[data-reveal]:not(.is-in)")];
  if (reducedMotion() || typeof IntersectionObserver === "undefined") {
    for (const el of els) el.classList.add("is-in");
    return;
  }
  document.documentElement.classList.add("js-reveal");
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("is-in");
        observer!.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -6% 0px", threshold: 0.12 },
  );
  for (const el of els) observer.observe(el);
}

const runs = new WeakMap<Element, number>();
const nextRun = (el: Element): number => {
  const id = (runs.get(el) ?? 0) + 1;
  runs.set(el, id);
  return id;
};
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/// Counts a number up from 0 when it scrolls into view. The text already in the element is the
/// final value, so screen readers and no-JS readers get the real number. Handles "39%", "1,200", "40".
export function countUp(el: HTMLElement, ms = 700): void {
  const final = el.textContent ?? "";
  const m = /^(\D*)([\d,]+(?:\.\d+)?)(.*)$/.exec(final.trim());
  if (!m || reducedMotion()) return;
  const [, pre, num, post] = m;
  const target = Number(num.replace(/,/g, ""));
  const decimals = num.includes(".") ? num.split(".")[1].length : 0;
  const fmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: num.includes(",") });
  el.setAttribute("aria-label", final.trim());
  const run = nextRun(el);
  const start = () => {
    const t0 = performance.now();
    const tick = (now: number) => {
      if (runs.get(el) !== run) return;
      const p = Math.min(1, (now - t0) / ms);
      el.textContent = `${pre}${fmt.format(target * easeOut(p))}${post}`;
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = final;
    };
    requestAnimationFrame(tick);
  };
  if (typeof IntersectionObserver === "undefined") return start();
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    io.disconnect();
    start();
  }, { threshold: 0.4 });
  io.observe(el);
}

/// "Writes" text into an element. Screen readers get the whole text at once through a hidden copy;
/// the visible copy is aria-hidden. Long text speeds up so a write never takes longer than maxMs.
export function typewrite(el: HTMLElement, text: string, opts: { cps?: number; maxMs?: number } = {}): Promise<void> {
  const run = nextRun(el);
  const visible = document.createElement("span");
  visible.setAttribute("aria-hidden", "true");
  const hidden = document.createElement("span");
  hidden.className = "sr-only";
  hidden.textContent = text;
  el.replaceChildren(visible, hidden);
  if (reducedMotion() || !text) {
    visible.textContent = text;
    return Promise.resolve();
  }
  const cps = Math.max(opts.cps ?? 90, (text.length * 1000) / (opts.maxMs ?? 1400));
  el.classList.add("is-typing");
  return new Promise((resolve) => {
    const t0 = performance.now();
    const tick = (now: number) => {
      if (runs.get(el) !== run) return resolve();
      const n = Math.min(text.length, Math.floor(((now - t0) / 1000) * cps));
      visible.textContent = text.slice(0, n);
      if (n < text.length) return void requestAnimationFrame(tick);
      el.classList.remove("is-typing");
      resolve();
    };
    requestAnimationFrame(tick);
  });
}

const HEX = "0123456789abcdef";
/// Resolves a hash left to right out of random hex, like a check settling. Only for short
/// displayed hashes (a page title or the receipt hash), never for long code blocks.
export function decode(el: HTMLElement, ms = 520): void {
  const final = el.textContent ?? "";
  if (reducedMotion() || final.length > 80) return;
  const run = nextRun(el);
  el.setAttribute("aria-label", final);
  const t0 = performance.now();
  const tick = (now: number) => {
    if (runs.get(el) !== run) return;
    const p = Math.min(1, (now - t0) / ms);
    const fixed = Math.floor(final.length * easeOut(p));
    let s = final.slice(0, fixed);
    for (let i = fixed; i < final.length; i++) s += /[0-9a-f]/i.test(final[i]) ? HEX[(Math.random() * 16) | 0] : final[i];
    el.textContent = s;
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = final;
  };
  requestAnimationFrame(tick);
}

/// Swaps page content inside a View Transition when the browser has one (a crossfade with a
/// short rise, styled in polish.css). Falls back to a plain swap. Never awaited by callers.
export function swap(update: () => void): void {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (!doc.startViewTransition || reducedMotion()) return update();
  doc.startViewTransition(update);
}
