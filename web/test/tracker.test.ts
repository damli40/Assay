// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { askErrorText, batchEvery, strictFetch } from "../src/views/ask.js";
import { batchEta, createTracker, fmtClock, type TrackStep } from "../src/ui/tracker.js";

const steps = (): TrackStep[] => [
  { id: "asked", label: "Asked", state: "done", panel: () => document.createTextNode("asked panel") },
  { id: "signed", label: "Signed", state: "done", panel: () => document.createTextNode("signed panel") },
  { id: "batched", label: "Batched", state: "now", meta: "1:38", panel: () => document.createTextNode("batched panel") },
  { id: "anchored", label: "Anchored", state: "todo", panel: () => document.createTextNode("anchored panel") },
];
const tabs = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
const panelText = (el: HTMLElement) => el.querySelector('[role="tabpanel"]')!.textContent;

describe("clock and batch countdown", () => {
  it("formats m:ss, and tenths under ten seconds when asked", () => {
    expect(fmtClock(0)).toBe("0:00");
    expect(fmtClock(61_000)).toBe("1:01");
    expect(fmtClock(-5)).toBe("0:00");
    expect(fmtClock(2_140, true)).toBe("2.1 s");
    expect(fmtClock(12_000, true)).toBe("0:12");
  });

  it("counts down one interval after signing when the host reports no batch clock", () => {
    expect(batchEta({ signedAt: 0, now: 30_000, intervalMs: 120_000 })).toEqual({ remaining: 90_000, frac: 0.25, phase: "counting" });
    expect(batchEta({ signedAt: 0, now: 125_000, intervalMs: 120_000 }).phase).toBe("due");
    expect(batchEta({ signedAt: 0, now: 151_000, intervalMs: 120_000 }).phase).toBe("late");
  });

  it("uses the host's next batch time when it has one, and ignores one from before signing", () => {
    expect(batchEta({ signedAt: 0, now: 30_000, intervalMs: 120_000, nextAt: 40_000 })).toEqual({ remaining: 10_000, frac: 0.75, phase: "counting" });
    expect(batchEta({ signedAt: 10_000, now: 30_000, intervalMs: 120_000, nextAt: 5_000 }).remaining).toBe(100_000);
  });
});

describe("tracker", () => {
  it("is a tablist that opens the live step, with one tab stop and each step's state in words", () => {
    const t = createTracker(steps(), { label: "Where your receipt is" });
    expect(t.el.querySelector('[role="tablist"]')!.getAttribute("aria-label")).toBe("Where your receipt is");
    const ts = tabs(t.el);
    expect(ts.map((b) => b.getAttribute("aria-selected"))).toEqual(["false", "false", "true", "false"]);
    expect(ts.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    expect(ts[2].getAttribute("aria-current")).toBe("step");
    expect(ts[2].textContent).toContain("step 3 of 4, in progress");
    expect(ts[2].querySelector(".track-meta")!.getAttribute("aria-hidden")).toBe("true");
    expect(panelText(t.el)).toBe("batched panel");
  });

  it("stays on the step the reader opened, offers a way back, and follows again from there", () => {
    const t = createTracker(steps(), { label: "x" });
    tabs(t.el)[1].click();
    expect(panelText(t.el)).toBe("signed panel");
    expect(t.following()).toBe(false);
    const back = t.el.querySelector<HTMLButtonElement>(".track-back")!;
    expect(back.hidden).toBe(false);
    expect(back.textContent).toBe("Back to live: Batched · 1:38");
    t.update("batched", { state: "done" });
    t.update("anchored", { state: "done" });
    expect(panelText(t.el)).toBe("signed panel");
    back.click();
    expect(panelText(t.el)).toBe("anchored panel");
    expect(t.following()).toBe(true);
  });

  it("follows the live step while the reader hasn't picked one, and announces step changes only", () => {
    const t = createTracker(steps(), { label: "x" });
    const live = t.el.querySelector('[aria-live="polite"]')!;
    t.update("batched", { meta: "1:37" });
    expect(live.textContent).toBe("");
    t.update("batched", { state: "done" });
    t.update("anchored", { state: "done" });
    expect(t.selected()).toBe("anchored");
    expect(live.textContent).toBe("Anchored, done");
  });

  it("moves with the arrow keys, Home and End", () => {
    const t = createTracker(steps(), { label: "x" });
    document.body.append(t.el);
    const ts = tabs(t.el);
    ts[2].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(t.selected()).toBe("signed");
    ts[1].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(t.selected()).toBe("anchored");
    expect(document.activeElement).toBe(ts[3]);
    t.el.remove();
  });
});

describe("ask errors and copy", () => {
  it("passes the host's own message and status through, before wrap() looks for a receipt", async () => {
    const f = strictFetch(async () => new Response(JSON.stringify({ error: { message: "requests are limited to 120 per hour per client" } }), { status: 429 }));
    const e = await f("x").catch((x: unknown) => x);
    expect(askErrorText(e)).toBe("Requests are limited to 120 per hour per client. Try again later.");
  });

  it("says plainly when the host is down or unreachable", () => {
    expect(askErrorText(Object.assign(new Error("HTTP 502"), { status: 502 }))).toBe("The host couldn't answer (HTTP 502). Try again in a moment.");
    expect(askErrorText(new TypeError("Failed to fetch"))).toBe("Couldn't reach the host. Check your connection and try again.");
  });

  it("names the batch interval in words", () => {
    expect(batchEvery(120)).toBe("every 2 minutes");
    expect(batchEvery(60)).toBe("every minute");
    expect(batchEvery(45)).toBe("every 45 seconds");
  });
});
