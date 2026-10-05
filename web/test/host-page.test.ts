// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { hostProfile, type HostProfile } from "../src/lib/indexer.js";
import { parseHash } from "../src/router.js";
import { lastDays, mountHost, renderHost } from "../src/views/host.js";

// Shape and values from the live indexer for agent 1962 on 3 Oct.
const live = {
  Agent: [{ agentId: "1962", owner: "0xf3cbd8aaf1f2350bfd8a3220ab4e83fdd8fa18d9", agentURI: "https://example.org/host.json", registeredBlock: 67269809, cardStatus: "OK", name: "Assay reference host", description: "OpenAI-compatible inference proxy.", services: [{ name: "spec", endpoint: "https://github.com/trudransh/Assay/blob/main/SPEC.md" }], anchorCount: 1, receiptCount: 1, cosignCount: 0, keyCount: 1, currentKey: { keyHash: "0x6c73fb3eca37810218b75460eb99a7aede153cf3ec8858a6dca1c06a1153a68e" } }],
  HostKey: [{ keyHash: "0x6c73fb3eca37810218b75460eb99a7aede153cf3ec8858a6dca1c06a1153a68e", setBlock: 67464463, retiredBlock: null, active: true, anchorCount: 1 }],
  KeyRotation: [{ block: 67464463, txHash: "0xcfd45e4304e7de3c0337eb83288d657e978efc2a0df614c74cfb1a9adcc7b8b4", toKey: { keyHash: "0x6c73fb3eca37810218b75460eb99a7aede153cf3ec8858a6dca1c06a1153a68e" } }],
  Anchor: [{ root: "0x8c89bd8a6495777123457221aae3a0ecf237dd6bd057b404a034ae4acdabbab2", count: 1, cosignCount: 0, block: 67577033, txHash: "0x41f73bcaa5270d16df2cbdafc920b0fa7f6e87890f968acece7f3c6a99a7a867", hostKey: { keyHash: "0x6c73fb3eca37810218b75460eb99a7aede153cf3ec8858a6dca1c06a1153a68e" } }],
  HostActivity: [{ day: "2026-10-02", anchors: 1, receipts: 1, cosigns: 0 }],
  Grade: [],
};
const gql = (data: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify({ data }), { status })) as unknown as typeof fetch;

describe("host profile", () => {
  it("reads the whole profile in one query and renders it", async () => {
    const f = gql(live);
    const p = (await hostProfile(1962n, "0xbc6bc5b79f83de1bb4e63bacbdb8d82c8a38e1c9caa38043f8b6ba33ffb33e6c", "https://idx.example", f))!;
    expect((f as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
    const el = renderHost(p);
    expect(el.querySelector("h1")!.textContent).toBe("Assay reference host");
    expect([...el.querySelectorAll(".tile-value")].map((t) => t.textContent)).toEqual(["1", "1", "0", "1"]);
    expect(el.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(el.textContent).toContain("67577033");
    expect(el.textContent).toContain("No grade yet");
    expect(el.querySelectorAll(".bars li")).toHaveLength(14);
  });

  it("fills missing days with zeros, oldest first", () => {
    const days = lastDays([{ day: "2026-10-02", anchors: 1, receipts: 3, cosigns: 0 }], new Date("2026-10-03T12:00:00Z"));
    expect(days).toHaveLength(14);
    expect(days[0].day).toBe("2026-09-20");
    expect(days[12]).toMatchObject({ day: "2026-10-02", receipts: 3 });
    expect(days[13]).toMatchObject({ day: "2026-10-03", receipts: 0 });
  });

  it("shows the indexer state, not an error stack, when it's down or the agent is unknown", async () => {
    const down = document.createElement("main");
    mountHost(down, parseHash("#hosts/1962"), async () => { throw new Error("Indexer: HTTP 503"); });
    await vi.waitFor(() => expect(down.textContent).toContain("needs the indexer"));

    const unknown = document.createElement("main");
    mountHost(unknown, parseHash("#hosts/99999"), async () => null);
    await vi.waitFor(() => expect(unknown.textContent).toContain("No agent 99999"));
  });

  it("moves the network switch to the chain the agent was found on", async () => {
    const { mountNetworkSwitch } = await import("../src/ui/network-switch.js");
    const bar = document.createElement("div");
    mountNetworkSwitch(bar);
    const profile = { agent: live.Agent[0], keys: live.HostKey, rotations: live.KeyRotation, anchors: live.Anchor, activity: live.HostActivity, grades: [] } as unknown as HostProfile;
    const el = document.createElement("main");
    // Picked network is mainnet (143); this agent only exists on testnet.
    mountHost(el, parseHash("#hosts/1962"), async (_id, _key, _a, _b, c) => (c === 10143 ? profile : null));
    await vi.waitFor(() => expect(el.textContent).toContain("Assay reference host"));
    expect(bar.querySelector(".net")!.getAttribute("data-chain")).toBe("10143");
    expect(bar.querySelector(".net")!.classList.contains("net-override")).toBe(true);
  });

  it("renders indexer text as text", () => {
    const p = { ...live, agent: { ...live.Agent[0], name: "<img src=x onerror=alert(1)>" } } as unknown as HostProfile;
    const el = renderHost({ ...p, keys: live.HostKey, rotations: live.KeyRotation, anchors: live.Anchor, activity: live.HostActivity, grades: [] } as HostProfile);
    expect(el.querySelector("img")).toBeNull();
  });
});

describe("batch receipts", () => {
  it("asks the host only when opened, then links each receipt", async () => {
    const { batchReceipts } = await import("../src/views/host.js");
    const root = `0x${"bb".repeat(32)}` as const;
    const r = `0x${"cc".repeat(32)}` as const;
    const load = vi.fn(async () => ({ root, count: 1, receipts: [r] }));
    const d = batchReceipts(root, 143, load) as HTMLDetailsElement;
    expect(load).not.toHaveBeenCalled();
    d.open = true;
    d.dispatchEvent(new Event("toggle"));
    await vi.waitFor(() => expect(d.querySelector(`a[href="#r/${r}"]`)).not.toBeNull());
    expect(load).toHaveBeenCalledOnce();
  });
});
