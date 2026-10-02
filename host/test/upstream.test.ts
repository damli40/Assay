import { describe, expect, it } from "vitest";
import { OPENROUTER_URL, openRouter, providerMatches, providerPin } from "../src/upstream.js";

describe("upstream", () => {
  it("posts to OpenRouter with the key and returns status + JSON", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ ok: 1 }), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await openRouter("sk-x", fake)({ model: "m", messages: [] });
    expect(out).toEqual({ status: 200, json: { ok: 1 } });
    expect(seen?.url).toBe(OPENROUTER_URL);
    expect((seen?.init.headers as Record<string, string>).authorization).toBe("Bearer sk-x");
  });

  it("posts to a direct upstream URL when one is given", async () => {
    let url = "";
    const fake = (async (u: string) => {
      url = u;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await openRouter("g-key", fake, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions")({});
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
  });

  it("maps a non-JSON 200 to 502", async () => {
    const fake = (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch;
    expect((await openRouter("k", fake)({})).status).toBe(502);
  });

  it("pins with allow_fallbacks false only when a provider is set", () => {
    expect(providerPin("z-ai")).toEqual({ provider: { only: ["z-ai"], allow_fallbacks: false } });
    expect(providerPin(undefined)).toEqual({});
  });

  it("matches slugs to display names", () => {
    expect(providerMatches("z-ai", "Z.AI")).toBe(true);
    expect(providerMatches("deepinfra/fp8", "DeepInfra")).toBe(true);
    expect(providerMatches("z-ai", "Chutes")).toBe(false);
    expect(providerMatches("z-ai", undefined)).toBe(false);
  });
});
