export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface UpstreamResult {
  status: number;
  json: unknown;
}

/// Sends an OpenAI-style chat body and returns the raw status and JSON. Injected so tests run offline.
export type Upstream = (body: Record<string, unknown>) => Promise<UpstreamResult>;

export function openRouter(apiKey: string, fetchFn: typeof fetch = fetch): Upstream {
  return async (body) => {
    const res = await fetchFn(OPENROUTER_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    try {
      return { status: res.status, json: JSON.parse(text) };
    } catch {
      return { status: res.status === 200 ? 502 : res.status, json: { error: { message: "upstream returned non-JSON" } } };
    }
  };
}

/// Pinning as in the harness: only this provider, no silent fallback to another one.
export function providerPin(provider: string | undefined): Record<string, unknown> {
  return provider ? { provider: { only: [provider], allow_fallbacks: false } } : {};
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/// OpenRouter pins by slug ("z-ai", "deepinfra/fp8") but reports a display name ("Z.AI", "DeepInfra").
export function providerMatches(pinned: string, servedBy: unknown): boolean {
  return typeof servedBy === "string" && norm(servedBy) === norm(pinned.split("/")[0]);
}
