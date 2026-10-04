type Child = Node | string | null | undefined | false;

/// Tiny element builder. Text children go through text nodes, so nothing here parses HTML.
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false) continue;
    el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

const SVG = "http://www.w3.org/2000/svg";
const ICONS = {
  copy: "M8 8h11v11H8zM5 16V5h11",
  check: "M5 12.5l4.5 4.5L19 7",
  alert: "M12 4l9 16H3zM12 10v4M12 17v.5",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.5",
} as const;

/// A 24px stroke icon, decorative (aria-hidden). Built as SVG nodes, not markup.
export function icon(name: keyof typeof ICONS): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", class: "icon", "aria-hidden": "true", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round" })) svg.setAttribute(k, v);
  const p = document.createElementNS(SVG, "path");
  p.setAttribute("d", ICONS[name]);
  svg.append(p);
  return svg;
}

let ids = 0;

/// A labelled input, textarea or select. `hint` and `error` are linked with aria-describedby.
export function field<T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(label: string, input: T, hint?: string, error?: string): { row: HTMLElement; input: T } {
  const id = input.id || `f${++ids}`;
  input.id = id;
  const row = h("div", { class: "field" }, h("label", { for: id }, label));
  row.append(input);
  if (hint) row.append(h("p", { class: "hint", id: `${id}-hint` }, hint));
  describe(input, hint ? `${id}-hint` : null);
  if (error) setFieldError(row, error);
  return { row, input };
}

function describe(input: Element, ...ids: (string | null)[]) {
  const list = ids.filter(Boolean).join(" ");
  if (list) input.setAttribute("aria-describedby", list);
  else input.removeAttribute("aria-describedby");
}

/// Shows or clears the error under a field made by `field()`.
export function setFieldError(row: HTMLElement, message: string | null) {
  const input = row.querySelector("input, textarea, select")!;
  const hint = row.querySelector(".hint");
  row.querySelector(".field-error")?.remove();
  if (message) {
    input.setAttribute("aria-invalid", "true");
    row.append(h("p", { class: "field-error", id: `${input.id}-err` }, icon("alert"), message));
    describe(input, hint?.id ?? null, `${input.id}-err`);
  } else {
    input.removeAttribute("aria-invalid");
    describe(input, hint?.id ?? null);
  }
}

/// Shown on a submit with two or more field errors: one link per field, and it takes focus.
export function errorSummary(errors: { fieldId: string; message: string }[]): HTMLElement {
  const list = h("ul");
  for (const e of errors) {
    const a = h("a", { href: `#${e.fieldId}` }, e.message);
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      document.getElementById(e.fieldId)?.focus();
    });
    list.append(h("li", {}, a));
  }
  const el = h("div", { class: "error-summary", role: "alert", tabindex: "-1" }, h("p", { class: "error-summary-title" }, errors.length === 1 ? "One field needs fixing" : `${errors.length} fields need fixing`), list);
  queueMicrotask(() => el.focus());
  return el;
}

export const input = (value = "", attrs: Record<string, string | boolean> = {}) => {
  const el = h("input", { type: "text", spellcheck: "false", autocomplete: "off", ...attrs });
  el.value = value;
  return el;
};

export const textarea = (attrs: Record<string, string | boolean> = {}) => h("textarea", { rows: "4", spellcheck: "false", ...attrs });

export type ButtonVariant = "primary" | "secondary" | "cosign" | "danger" | "ghost";

export function button(label: string, opts: { variant?: ButtonVariant; size?: "md" | "sm"; type?: "button" | "submit"; describedBy?: string } = {}): HTMLButtonElement {
  const { variant = "secondary", size = "md", type = "button", describedBy } = opts;
  return h("button", { type, class: `btn btn-${variant}${size === "sm" ? " btn-sm" : ""}`, "aria-describedby": describedBy ?? false }, label);
}

/// Writes to the shell's screen-reader region. A no-op outside the app shell (tests, other pages).
export function announce(text: string) {
  const el = document.getElementById("announce");
  if (!el) return;
  el.textContent = "";
  requestAnimationFrame(() => (el.textContent = text));
}

export function copyButton(text: string, label = "Copy"): HTMLButtonElement {
  const name = h("span", {}, label);
  const b = h("button", { type: "button", class: "copy", "aria-label": `${label} to clipboard` }, icon("copy"), name);
  let timer: ReturnType<typeof setTimeout> | undefined;
  b.addEventListener("click", async () => {
    // Fix the width on first use so "Copied" doesn't shift the row.
    if (!b.style.minWidth && b.offsetWidth) b.style.minWidth = `${b.offsetWidth}px`;
    try {
      await navigator.clipboard.writeText(text);
      name.textContent = "Copied";
      b.classList.add("copied");
      announce(`${label === "Copy" ? "Text" : label} copied`);
    } catch {
      name.textContent = "Copy failed";
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      name.textContent = label;
      b.classList.remove("copied");
    }, 2000);
  });
  return b;
}

/// A polite live region: screen readers announce whatever is written to it.
export function liveRegion(): { el: HTMLElement; say(msg: string, kind?: "info" | "error" | "ok" | "pending"): void } {
  const el = h("div", { class: "status", role: "status", "aria-live": "polite" });
  return {
    el,
    say(msg, kind = "info") {
      el.dataset.kind = kind;
      el.textContent = msg;
    },
  };
}

/// One toast for actions with no visible result (copying a link). Never for errors.
export function toast(text: string) {
  const region = document.getElementById("toast");
  if (!region) return;
  region.replaceChildren(h("div", { class: "toast" }, icon("check"), text));
  setTimeout(() => region.replaceChildren(), 4000);
}

export const mono = (text: string) => h("code", { class: "mono" }, text);

/// `0x6c73fb3e…a68e`, with the full value in the title. Copy targets always get the full value.
export const shortHash = (hex: string) => h("code", { class: "mono", title: hex }, hex.length > 20 ? `${hex.slice(0, 10)}…${hex.slice(-4)}` : hex);

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type Tone = "gold" | "violet" | "pink" | "lime" | "coral" | "sky" | "muted";

export const chip = (text: string, tone: Tone = "muted", opts: { dot?: boolean; dashed?: boolean } = {}) =>
  h("span", { class: `chip chip-${tone}${opts.dashed ? " chip-dashed" : ""}` }, opts.dot ? h("span", { class: "dot", "aria-hidden": "true" }) : null, text);

export type BadgeState = "pass" | "fail" | "skipped" | "warn" | "unknown" | "pending" | "notchecked";

export const badge = (state: BadgeState, text: string) => h("span", { class: `badge ${state}` }, text);

/// The result heading. Focus it when a result lands.
export function verdict(kind: "ok" | "bad" | "pending" | "warn", title: string, detail?: string): HTMLElement {
  return h("div", { class: `verdict-box ${kind}` }, h("h2", { class: `verdict ${kind}`, tabindex: "-1" }, title), detail ? h("p", {}, detail) : null);
}

export function banner(tone: "coral" | "warn" | "sky", text: string, action?: HTMLElement): HTMLElement {
  return h("div", { class: `banner banner-${tone}`, role: tone === "coral" ? "alert" : "status" }, icon(tone === "sky" ? "info" : "alert"), h("p", {}, text), action);
}

export function emptyState(opts: { title: string; text: string; tone?: Tone; action?: HTMLElement }): HTMLElement {
  return h("div", { class: `empty empty-${opts.tone ?? "muted"}` }, h("span", { class: "empty-mark", "aria-hidden": "true" }), h("h2", {}, opts.title), h("p", {}, opts.text), opts.action);
}

/// Label/value rows. String values that look like hashes get shortHash plus a copy button.
export function kv(rows: [string, Node | string][]): HTMLElement {
  const dl = h("dl", { class: "kv" });
  for (const [k, v] of rows) {
    const value = typeof v === "string" && /^0x[0-9a-fA-F]{40,}$/.test(v) ? h("span", { class: "kv-hash" }, shortHash(v), copyButton(v, `Copy ${k.toLowerCase()}`)) : v;
    dl.append(h("dt", {}, k), h("dd", {}, value));
  }
  return dl;
}

/// Reserves the height of what's coming so the page doesn't jump.
export function skeleton(rows: number, height = 56): HTMLElement {
  const el = h("div", { class: "skeleton", "aria-hidden": "true" });
  for (let i = 0; i < rows; i++) el.append(h("div", { class: "skeleton-row", style: `height:${height}px` }));
  return el;
}

let tabName = "";
/// The router sets the tab name that section() shows as the page chip.
export const setPageTab = (name: string) => (tabName = name);

/// Page head from the boards (tab chip, h1, lede), then the page body.
export function section(title: string, intro: string, ...children: Child[]): HTMLElement {
  const head = h("header", { class: "page-head" }, tabName ? chip(tabName, "lime") : null, h("h1", { id: "page-title" }, title), h("p", { class: "lede" }, intro));
  return h("section", { class: "page", "aria-labelledby": "page-title" }, head, ...children);
}

const STAMP_TONE = { host: "gold", model: "bone", anchor: "violet", you: "pink", grade: "lime" } as const;
const svgEl = (tag: string, attrs: Record<string, string>, text?: string) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text) el.textContent = text;
  return el;
};

/// An octagon mark. Lit = filled; unlit = outline only (not reached yet).
export function stamp(kind: keyof typeof STAMP_TONE, sub: string, lit: boolean, label: string): HTMLElement {
  const svg = svgEl("svg", { viewBox: "0 0 100 100", "aria-hidden": "true" });
  const word = kind.toUpperCase();
  svg.append(
    svgEl("polygon", { class: "st-fill", points: "29,4 71,4 96,29 96,71 71,96 29,96 4,71 4,29" }),
    svgEl("polygon", { class: "st-ring", points: "32,13 68,13 87,32 87,68 68,87 32,87 13,68 13,32" }),
    svgEl("text", { class: `st-big${word.length > 5 ? " st-xs" : word.length > 4 ? " st-sm" : ""}`, x: "50", y: "48" }, word),
    svgEl("text", { class: "st-small", x: "50", y: "66" }, sub.length > 9 ? `${sub.slice(0, 8)}…` : sub),
  );
  return h("div", { class: `stamp k-${STAMP_TONE[kind]}${lit ? "" : " unlit"}`, role: "img", "aria-label": label }, svg);
}

const LEVELS = [
  ["Signed and anchored", "The host signed what it served and the batch is on Monad. A lie can't be denied later."],
  ["Host graded", "A verifier you trust tested this host against the lab's endpoint. It grades the host, not this response."],
  ["Re-executable", "A deterministic runtime lets a verifier re-run a revealed request and compare output hashes."],
  ["TEE attested", "The host signs from an enclave whose attestation includes a model hash."],
] as const;

/// Levels 0 to 3. `reached` covers levels 0 and 1; 2 and 3 are always Roadmap.
export function levelLadder(reached: [boolean, boolean]): HTMLElement {
  const ol = h("ol", { class: "ladder" });
  LEVELS.forEach(([name, text], i) => {
    const state = i > 1 ? "roadmap" : reached[i as 0 | 1] ? "reached" : "notreached";
    const tag = state === "roadmap" ? chip("Roadmap", "muted", { dashed: true }) : state === "reached" ? chip("Reached", i ? "lime" : "gold", { dot: true }) : chip("Not reached", "muted");
    ol.append(h("li", { class: `level ${state} ${["k-gold", "k-lime", "", ""][i]}`, "data-level": String(i) }, tag, h("h3", {}, `Level ${i} · ${name}`), h("p", {}, text)));
  });
  return ol;
}

export type StepState = "done" | "now" | "todo";

/// Numbered steps with octagon markers. The `now` step pulses (off under reduced motion).
export function stepper(steps: { label: string; state: StepState; detail?: Node | string }[]): HTMLElement {
  return h(
    "ol",
    { class: "steps" },
    ...steps.map((s, i) =>
      h("li", { class: `step ${s.state}`, "aria-current": s.state === "now" ? "step" : false }, h("span", { class: "step-mark", "aria-hidden": "true" }, s.state === "done" ? "✓" : String(i + 1)), h("div", {}, h("strong", {}, s.label), s.detail ? h("p", {}, s.detail) : null)),
    ),
  );
}

export function progress(opts: { value: number; max: number; valueText: string; label: string }): HTMLElement {
  const pct = Math.min(100, Math.round((opts.value / opts.max) * 100));
  return h(
    "div",
    { class: "progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(opts.max), "aria-valuenow": String(Math.round(opts.value)), "aria-valuetext": opts.valueText, "aria-label": opts.label },
    h("span", { style: `width:${pct}%` }),
  );
}

/// Native modal dialog. Cancel has focus; Escape cancels; focus returns to the opener.
export function confirmDialog(opts: { title: string; body: string; confirm: string; danger?: boolean }): Promise<boolean> {
  const opener = document.activeElement as HTMLElement | null;
  const cancel = button("Cancel");
  cancel.autofocus = true;
  const ok = button(opts.confirm, { variant: opts.danger ? "danger" : "primary" });
  const dlg = h("dialog", { class: "dialog", "aria-labelledby": "dlg-title" }, h("h2", { id: "dlg-title" }, opts.title), h("p", {}, opts.body), h("div", { class: "row" }, cancel, ok));
  document.body.append(dlg);
  return new Promise((resolve) => {
    const done = (v: boolean) => {
      dlg.close();
      dlg.remove();
      opener?.focus();
      resolve(v);
    };
    cancel.addEventListener("click", () => done(false));
    ok.addEventListener("click", () => done(true));
    dlg.addEventListener("cancel", (e) => {
      e.preventDefault();
      done(false);
    });
    dlg.showModal();
  });
}
