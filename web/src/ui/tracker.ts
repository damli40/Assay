import { h } from "../dom.js";

/// Where a receipt is, as steps you can open one by one. The rail is a tablist: each step opens its own
/// panel with the proof for that step. The panel follows the live step until the reader picks another one,
/// then a "Back to live" button brings it back. Times on the rail never go to the live region; only step
/// changes are announced.

export type TrackState = "todo" | "now" | "done" | "error";

export interface TrackStep {
  id: string;
  label: string;
  state: TrackState;
  /// Short text under the label: a running clock, a countdown, how long the step took.
  meta?: string;
  /// The step's colour once done, from the receipt stamps: bone (asked), gold (host), sky (waiting), violet (onchain), pink (you).
  tone?: "bone" | "gold" | "sky" | "violet" | "pink";
  /// The panel for this step. Return the same node every time so live parts (a countdown) keep updating.
  panel: () => Node;
}

export interface Tracker {
  el: HTMLElement;
  update(id: string, patch: Partial<Pick<TrackStep, "label" | "state" | "meta" | "panel">>): void;
  /// Opens a step's panel. `null` goes back to following the live step.
  select(id: string | null): void;
  selected(): string;
  following(): boolean;
}

const STATE_WORD: Record<TrackState, string> = { done: "done", now: "in progress", todo: "not yet", error: "failed" };
let uid = 0;

/// m:ss for clocks and countdowns, "2.1 s" under ten seconds when `short` is set.
export function fmtClock(ms: number, short = false): string {
  const v = Math.max(0, ms);
  if (short && v < 10_000) return `${(v / 1000).toFixed(1)} s`;
  const s = Math.floor(v / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/// How long until the receipt's batch should land, for the countdown.
/// - `nextAt`: when the host says its next batch fires (client clock), if the host reports it.
/// - Without it, one full interval after signing is the latest a healthy host can take.
/// Phases: counting down, "due" for 30 s after the target (the anchor tx is confirming), then "late".
export function batchEta(o: { signedAt: number; now: number; intervalMs: number; nextAt?: number }): {
  remaining: number;
  frac: number;
  phase: "counting" | "due" | "late";
} {
  const target = o.nextAt !== undefined && o.nextAt >= o.signedAt ? o.nextAt : o.signedAt + o.intervalMs;
  const span = Math.max(1, target - o.signedAt);
  const remaining = Math.max(0, target - o.now);
  const over = o.now - target;
  return { remaining, frac: Math.min(1, Math.max(0, (o.now - o.signedAt) / span)), phase: over < 0 ? "counting" : over < 30_000 ? "due" : "late" };
}

export function createTracker(initial: TrackStep[], opts: { label: string }): Tracker {
  const id = `trk${++uid}`;
  const steps = initial.map((s) => ({ ...s }));
  let follow = true;
  let current = liveId();

  const announcer = h("p", { class: "sr-only", role: "status", "aria-live": "polite" });
  const rail = h("div", { class: "track-rail", role: "tablist", "aria-label": opts.label });
  rail.style.setProperty("--n", String(steps.length));
  const panel = h("div", { class: "track-panel", role: "tabpanel", id: `${id}-panel`, tabindex: "0" });
  const back = h("button", { type: "button", class: "track-back", hidden: true });
  back.addEventListener("click", () => select(null, true));

  const nodes = new Map<string, { tab: HTMLButtonElement; mark: HTMLElement; label: HTMLElement; meta: HTMLElement; sr: HTMLElement }>();
  steps.forEach((s, i) => {
    const mark = h("span", { class: "track-mark", "aria-hidden": "true" });
    const label = h("span", { class: "track-label" });
    const meta = h("span", { class: "track-meta", "aria-hidden": "true" });
    const sr = h("span", { class: "sr-only" });
    const tab = h("button", { type: "button", role: "tab", id: `${id}-tab-${s.id}`, "aria-controls": `${id}-panel`, class: "track-node", "data-step": s.id }, mark, label, meta, sr);
    tab.style.setProperty("--i", String(i));
    tab.dataset.tone = s.tone ?? "bone";
    tab.addEventListener("click", () => select(s.id, true));
    tab.addEventListener("keydown", (e) => {
      const k = e.key;
      const to = k === "ArrowRight" || k === "ArrowDown" ? i + 1 : k === "ArrowLeft" || k === "ArrowUp" ? i - 1 : k === "Home" ? 0 : k === "End" ? steps.length - 1 : null;
      if (to === null) return;
      e.preventDefault();
      const next = steps[(to + steps.length) % steps.length];
      select(next.id, true);
      nodes.get(next.id)?.tab.focus();
    });
    nodes.set(s.id, { tab, mark, label, meta, sr });
    rail.append(tab);
  });

  const el = h("div", { class: "track" }, rail, h("div", { class: "track-follow" }, back), panel, announcer);

  function liveId(): string {
    return (steps.find((s) => s.state === "now" || s.state === "error") ?? [...steps].reverse().find((s) => s.state === "done") ?? steps[0]).id;
  }

  function paint(s: TrackStep, i: number) {
    const n = nodes.get(s.id)!;
    n.tab.dataset.state = s.state;
    n.mark.textContent = s.state === "done" ? "✓" : s.state === "error" ? "✕" : String(i + 1);
    n.label.textContent = s.label;
    n.meta.textContent = s.meta ?? "";
    n.sr.textContent = `, step ${i + 1} of ${steps.length}, ${STATE_WORD[s.state]}`;
    if (s.state === "now") n.tab.setAttribute("aria-current", "step");
    else n.tab.removeAttribute("aria-current");
  }

  function paintRail() {
    steps.forEach(paint);
    const live = steps.findIndex((s) => s.id === liveId());
    const done = steps.filter((s) => s.state === "done").length;
    // The fill reaches the live step's mark; when every step is done it reaches the last one.
    rail.style.setProperty("--fill", String(steps.length > 1 ? Math.min(1, (done === steps.length ? steps.length - 1 : live) / (steps.length - 1)) : 1));
  }

  function select(next: string | null, byUser = false) {
    if (byUser) follow = next === null || next === liveId();
    current = next ?? liveId();
    for (const [sid, n] of nodes) {
      const on = sid === current;
      n.tab.setAttribute("aria-selected", String(on));
      n.tab.tabIndex = on ? 0 : -1;
    }
    panel.setAttribute("aria-labelledby", `${id}-tab-${current}`);
    const step = steps.find((s) => s.id === current)!;
    panel.replaceChildren(step.panel());
    panel.dataset.step = current;
    // Restart the panel's fade by toggling the class.
    panel.classList.remove("track-in");
    void panel.offsetWidth;
    panel.classList.add("track-in");
    paintBack();
  }

  function paintBack() {
    const live = steps.find((s) => s.id === liveId())!;
    back.hidden = follow || current === live.id;
    back.textContent = `Back to live: ${live.label}${live.meta ? ` · ${live.meta}` : ""}`;
  }

  paintRail();
  select(current);

  return {
    el,
    update(sid, patch) {
      const s = steps.find((x) => x.id === sid);
      if (!s) return;
      const before = s.state;
      const panelChanged = patch.panel !== undefined && patch.panel !== s.panel;
      Object.assign(s, patch);
      if (patch.state !== undefined && patch.state !== before) {
        const n = nodes.get(sid)!;
        if (patch.state === "done") n.tab.classList.add("track-punch");
        if (patch.state === "now" || patch.state === "done" || patch.state === "error") announcer.textContent = `${s.label}${patch.state === "error" ? ", failed" : patch.state === "now" ? "" : ", done"}`;
        paintRail();
        if (follow) return select(null);
      } else {
        paint(s, steps.indexOf(s));
      }
      if (panelChanged && current === sid) select(sid);
      paintBack();
    },
    select: (sid) => select(sid, true),
    selected: () => current,
    following: () => follow,
  };
}
