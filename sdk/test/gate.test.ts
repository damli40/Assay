import { describe, expect, it } from "vitest";
import type { GradeStatus } from "../src/grade.js";
import { GradeGateError, hostGradeCheck, wrap } from "../src/wrap.js";

// A host fetch that records whether the request went out. It returns no receipt, so an allowed
// request ends in wrap's "no X-Assay-Receipt" error, which proves it was sent.
function host() {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const status = (s: GradeStatus) => async () => s;
const ASK = "https://host.example/v1/chat/completions";

describe("grade gate", () => {
  it("sends the request when the host passes", async () => {
    const h = host();
    await expect(wrap(h.fetchImpl, { gate: { check: status("pass") } })(ASK, { method: "POST" })).rejects.toThrow(/X-Assay-Receipt/);
    expect(h.calls).toEqual([ASK]);
  });

  it.each<GradeStatus>(["warn", "unknown", "fail"])("refuses a %s host by default and sends nothing", async (s) => {
    const h = host();
    const err = await wrap(h.fetchImpl, { gate: { check: status(s) } })(ASK).catch((e) => e);
    expect(err).toBeInstanceOf(GradeGateError);
    expect(err.status).toBe(s);
    expect(h.calls).toEqual([]);
  });

  it("lets the caller widen what is allowed", async () => {
    const h = host();
    const ask = wrap(h.fetchImpl, { gate: { check: status("warn"), allow: ["pass", "warn"] } });
    await expect(ask(ASK)).rejects.toThrow(/X-Assay-Receipt/);
    expect(h.calls).toHaveLength(1);
  });

  it("skips the check for calls the caller marks as cheap", async () => {
    const h = host();
    let checked = false;
    const ask = wrap(h.fetchImpl, {
      gate: { check: async () => ((checked = true), "fail"), skip: (init) => (init.headers as Record<string, string>)?.["x-cheap"] === "1" },
    });
    await expect(ask(ASK, { headers: { "x-cheap": "1" } })).rejects.toThrow(/X-Assay-Receipt/);
    expect(checked).toBe(false);
    expect(h.calls).toHaveLength(1);
  });

  it("fails closed when the grade can't be read", async () => {
    const h = host();
    const err = await wrap(h.fetchImpl, { gate: { check: async () => { throw new Error("rpc down"); } } })(ASK).catch((e) => e);
    expect(err).toBeInstanceOf(GradeGateError);
    expect(err.status).toBe("error");
    expect(err.message).toMatch(/rpc down/);
    expect(h.calls).toEqual([]);
  });
});

describe("hostGradeCheck", () => {
  it("queries GET /v1/grade with the model, host, verifiers and reference", async () => {
    let url = "";
    const fetchImpl = (async (u: string) => {
      url = u;
      return new Response(JSON.stringify({ status: "warn" }), { status: 200 });
    }) as unknown as typeof fetch;
    const check = hostGradeCheck("https://host.example/", { model: "z-ai/glm-5.3", host: "erc8004:10143:1962", verifiers: ["0xa", "0xb"], reference: "openrouter:z-ai/fp8" }, fetchImpl);
    expect(await check()).toBe("warn");
    const u = new URL(url);
    expect(u.pathname).toBe("/v1/grade");
    expect(Object.fromEntries(u.searchParams)).toEqual({ model: "z-ai/glm-5.3", host: "erc8004:10143:1962", verifiers: "0xa,0xb", reference: "openrouter:z-ai/fp8" });
  });

  it("throws on a non-200 so the gate fails closed", async () => {
    const fetchImpl = (async () => new Response("{}", { status: 502 })) as unknown as typeof fetch;
    await expect(hostGradeCheck("https://h", { model: "m", host: "direct:x", verifiers: ["0xa"] }, fetchImpl)()).rejects.toThrow(/502/);
  });
});
