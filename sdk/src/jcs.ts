import canonicalize from "canonicalize";

/// RFC 8785 canonical JSON. canonicalize already rejects NaN, Infinity and BigInt, but it silently
/// drops `undefined` object values and turns `[undefined]` into `[null]`, so we reject undefined first.
export function jcs(value: unknown): string {
  rejectUndefined(value, "$");
  const out = canonicalize(value);
  if (out === undefined) throw new Error("jcs: value cannot be serialized");
  return out;
}

function rejectUndefined(value: unknown, path: string): void {
  if (value === undefined) throw new Error(`jcs: undefined at ${path}`);
  if (Array.isArray(value)) value.forEach((v, i) => rejectUndefined(v, `${path}[${i}]`));
  else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) rejectUndefined(v, `${path}.${k}`);
  }
}
