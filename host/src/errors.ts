/// Error text that is safe to send to a client. viem's full message names the RPC URL, and ours carry
/// an API token, so callers get the short message with every URL removed; the full error goes to the log.
export function publicError(e: unknown, log: Pick<Console, "error"> = console): string {
  log.error(e);
  const err = e as { shortMessage?: unknown; message?: unknown } | null;
  const text = typeof err?.shortMessage === "string" ? err.shortMessage : typeof err?.message === "string" ? err.message : String(e);
  return text.replace(/\b(?:https?|wss?):\/\/\S+/gi, "<url>").split("\n")[0].slice(0, 300);
}
