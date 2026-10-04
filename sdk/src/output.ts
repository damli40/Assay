import { jcs } from "./jcs.js";

/// What `res.commit` covers: the assistant's text, or, when it answered only with tool calls,
/// the JCS bytes of `tool_calls` exactly as returned. Undefined when there's neither.
export function assistantOutput(message: unknown): string | undefined {
  if (typeof message !== "object" || message === null) return undefined;
  const m = message as { content?: unknown; tool_calls?: unknown };
  if (typeof m.content === "string" && m.content !== "") return m.content;
  if (Array.isArray(m.tool_calls) && m.tool_calls.length > 0) return jcs(m.tool_calls);
  return typeof m.content === "string" ? m.content : undefined;
}
