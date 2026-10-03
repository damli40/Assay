export interface Route {
  path: string[];
  params: URLSearchParams;
}

/// `#grades/verifiers?model=x` → { path: ["grades", "verifiers"], params: model=x }. Empty hash is Verify.
export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "");
  const q = raw.indexOf("?");
  const pathPart = q === -1 ? raw : raw.slice(0, q);
  const path = pathPart.split("/").filter(Boolean).map(decodeURIComponent);
  return { path: path.length ? path : ["verify"], params: new URLSearchParams(q === -1 ? "" : raw.slice(q + 1)) };
}

/// The top-level tab a route lights: #r/<hash> belongs to Verify, #hosts/<id> to Hosts.
export function tabOf(route: Route): string {
  return route.path[0] === "r" ? "verify" : route.path[0];
}

export type Match =
  | { view: "verify" | "ask" | "grades" | "vault" }
  | { view: "receipt"; hash: string }
  | { view: "host"; agentId: string }
  | { view: "planned"; title: string; step: number }
  | { view: "notFound" };

const RECEIPT_HASH = /^0x[0-9a-fA-F]{64}$/;

/// Route table from routes.md. Views not built yet map to the build step that adds them.
export function match({ path }: Route): Match {
  const [top, sub, extra] = path;
  if (extra !== undefined) return { view: "notFound" };
  switch (top) {
    case "verify":
    case "ask":
    case "vault":
      return sub === undefined ? { view: top } : { view: "notFound" };
    case "grades":
      if (sub === undefined) return { view: "grades" };
      return sub === "verifiers" ? { view: "planned", title: "Verifiers", step: 7 } : { view: "notFound" };
    case "hosts":
      if (sub === undefined) return { view: "planned", title: "Hosts", step: 7 };
      // Agent ids open the profile now; OpenRouter tags (graded-only hosts) come with the leaderboard.
      return /^[1-9]\d*$/.test(sub) ? { view: "host", agentId: sub } : { view: "planned", title: "Host profile", step: 7 };
    case "developers":
      return sub === undefined ? { view: "planned", title: "Developers", step: 8 } : { view: "notFound" };
    case "r":
      return sub !== undefined && RECEIPT_HASH.test(sub) ? { view: "receipt", hash: sub.toLowerCase() } : { view: "notFound" };
    default:
      return { view: "notFound" };
  }
}
