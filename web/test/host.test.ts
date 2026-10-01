import { afterEach, describe, expect, it, vi } from "vitest";
import { hostUrl, relayCosign } from "../src/lib/host.js";

const b32 = (b: string) => `0x${b.repeat(32)}` as const;

afterEach(() => vi.unstubAllGlobals());

describe("host client", () => {
  it("joins base URLs without double slashes", () => {
    expect(hostUrl(" https://h.example/ ", "/v1/cosign")).toBe("https://h.example/v1/cosign");
    expect(hostUrl("/host", "/v1/cosign")).toBe("/host/v1/cosign");
  });

  it("sends WebAuthn indexes as decimal strings, the shape POST /v1/cosign accepts", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ txHash: b32("cc") })));
    vi.stubGlobal("fetch", fetch);
    const auth = { r: b32("01"), s: b32("02"), challengeIndex: 23n, typeIndex: 1n, authenticatorData: "0x05" as const, clientDataJSON: "{}" };
    expect(await relayCosign("/host", b32("aa"), b32("bb"), b32("dd"), auth)).toEqual({ txHash: b32("cc") });
    const sent = JSON.parse(fetch.mock.calls[0][1].body as string);
    expect(sent).toEqual({ receiptHash: b32("aa"), qx: b32("bb"), qy: b32("dd"), auth: { ...auth, challengeIndex: "23", typeIndex: "1" } });
  });

  it("surfaces the host's error message", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { message: "receipt is not anchored yet" } }), { status: 409 }));
    const auth = { r: b32("01"), s: b32("02"), challengeIndex: 0n, typeIndex: 0n, authenticatorData: "0x" as const, clientDataJSON: "{}" };
    await expect(relayCosign("/host", b32("aa"), b32("bb"), b32("dd"), auth)).rejects.toThrow(/409, receipt is not anchored yet/);
  });
});
