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

let ids = 0;

/// A labelled input, textarea or select. `hint` is linked with aria-describedby.
export function field<T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(label: string, input: T, hint?: string): { row: HTMLElement; input: T } {
  const id = input.id || `f${++ids}`;
  input.id = id;
  const row = h("div", { class: "field" }, h("label", { for: id }, label));
  row.append(input);
  if (hint) {
    input.setAttribute("aria-describedby", `${id}-hint`);
    row.append(h("p", { class: "hint", id: `${id}-hint` }, hint));
  }
  return { row, input };
}

export const input = (value = "", attrs: Record<string, string | boolean> = {}) => {
  const el = h("input", { type: "text", spellcheck: "false", autocomplete: "off", ...attrs });
  el.value = value;
  return el;
};

export const textarea = (attrs: Record<string, string | boolean> = {}) => h("textarea", { rows: "4", spellcheck: "false", ...attrs });

export function copyButton(text: string, label = "Copy"): HTMLButtonElement {
  const b = h("button", { type: "button", class: "copy", "aria-label": `${label} to clipboard` }, label);
  b.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      b.textContent = "Copied";
    } catch {
      b.textContent = "Copy failed";
    }
    setTimeout(() => (b.textContent = label), 1500);
  });
  return b;
}

/// A polite live region: screen readers announce whatever is written to it.
export function liveRegion(): { el: HTMLElement; say(msg: string, kind?: "info" | "error" | "ok"): void } {
  const el = h("div", { class: "status", role: "status", "aria-live": "polite" });
  return {
    el,
    say(msg, kind = "info") {
      el.dataset.kind = kind;
      el.textContent = msg;
    },
  };
}

export const mono = (text: string) => h("code", { class: "mono" }, text);

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function section(title: string, intro: string, ...children: Child[]): HTMLElement {
  return h("section", { class: "page", "aria-labelledby": "page-title" }, h("h1", { id: "page-title" }, title), h("p", { class: "lede" }, intro), ...children);
}
