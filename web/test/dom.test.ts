// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { badge, emptyState, errorSummary, field, input, kv, setFieldError, shortHash } from "../src/dom.js";

describe("dom helpers", () => {
  it("links hint and error to the input, and clears the error", () => {
    const f = field("Salt", input(), "64 hex characters");
    setFieldError(f.row, "The salt must be 32 bytes.");
    expect(f.input.getAttribute("aria-invalid")).toBe("true");
    expect(f.input.getAttribute("aria-describedby")).toBe(`${f.input.id}-hint ${f.input.id}-err`);
    expect(f.row.querySelector(".field-error")!.textContent).toBe("The salt must be 32 bytes.");
    setFieldError(f.row, null);
    expect(f.input.hasAttribute("aria-invalid")).toBe(false);
    expect(f.input.getAttribute("aria-describedby")).toBe(`${f.input.id}-hint`);
    expect(f.row.querySelector(".field-error")).toBeNull();
  });

  it("error summary links each field", () => {
    const el = errorSummary([{ fieldId: "a", message: "A is wrong" }, { fieldId: "b", message: "B is wrong" }]);
    expect(el.getAttribute("role")).toBe("alert");
    expect([...el.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["#a", "#b"]);
  });

  it("shortens hashes but keeps the full value", () => {
    const h = `0x${"6c".repeat(32)}`;
    const el = shortHash(h);
    expect(el.textContent).toBe(`${h.slice(0, 10)}…${h.slice(-4)}`);
    expect(el.title).toBe(h);
    expect(kv([["Root", h]]).querySelector("button")).not.toBeNull();
  });

  it("states carry a word, and empty states are never blank", () => {
    expect(badge("warn", "warn").textContent).toBe("warn");
    expect(emptyState({ title: "No grade yet", text: "Nobody graded it." }).textContent).toContain("No grade yet");
  });
});
