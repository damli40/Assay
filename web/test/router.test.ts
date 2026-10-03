import { describe, expect, it } from "vitest";
import { match, parseHash, tabOf } from "../src/router.js";

const hash = `0x${"ab".repeat(32)}`;

describe("router", () => {
  it("parses path and params, defaulting to verify", () => {
    expect(parseHash("").path).toEqual(["verify"]);
    const r = parseHash("#grades/verifiers?model=z-ai%2Fglm-5.3&v=0x1,0x2");
    expect(r.path).toEqual(["grades", "verifiers"]);
    expect(r.params.get("model")).toBe("z-ai/glm-5.3");
    expect(r.params.get("v")).toBe("0x1,0x2");
  });

  it("matches every route in routes.md", () => {
    for (const v of ["verify", "ask", "grades", "vault"]) expect(match(parseHash(`#${v}`))).toEqual({ view: v });
    expect(match(parseHash("#grades/verifiers"))).toMatchObject({ view: "planned", step: 7 });
    expect(match(parseHash("#hosts"))).toMatchObject({ view: "planned", title: "Hosts" });
    expect(match(parseHash("#hosts/1962"))).toMatchObject({ view: "planned", title: "Host profile" });
    expect(match(parseHash("#developers"))).toMatchObject({ view: "planned" });
    expect(match(parseHash(`#r/${hash}?host=https://h.example`))).toMatchObject({ view: "planned", title: "Receipt" });
  });

  it("sends unknown routes and malformed ids to 404", () => {
    for (const h of ["#nope", "#verify/x", "#r/0x12", "#r", "#grades/x", "#hosts/1962/extra"]) expect(match(parseHash(h))).toEqual({ view: "notFound" });
  });

  it("lights the parent tab", () => {
    expect(tabOf(parseHash(`#r/${hash}`))).toBe("verify");
    expect(tabOf(parseHash("#hosts/1962"))).toBe("hosts");
    expect(tabOf(parseHash("#grades/verifiers"))).toBe("grades");
  });
});
