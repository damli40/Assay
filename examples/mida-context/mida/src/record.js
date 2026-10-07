export class RecordError extends Error {
  constructor(message) {
    super(message);
    this.name = "RecordError";
    this.exitCode = 2;
  }
}

// A page came back `partial`: the store's list was incomplete. Callers turn this into the
// section-10 line with their own verb ("written" / "checked"); exit 3.
export class PartialListError extends Error {
  constructor() {
    super("the record list came back incomplete");
    this.name = "PartialListError";
    this.exitCode = 3;
  }
}

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const AGENT_ID = /^erc8004:(\d+):(\d+)$/;
const ZERO_AUTHOR = `0x${"0".repeat(64)}`;
const NAMESPACE = "projects.current";
const PAGE_LIMIT = 65_536;

const short = (id) => (typeof id === "string" && id.length > 12 ? `${id.slice(0, 10)}…` : id);
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

// One refused/ unavailable Mida failure as the section-10 line. The SDK message's final full
// stop is stripped before "Nothing was <verb>." is appended.
export function midaErrorLine(e, verb) {
  const code = typeof e?.code === "string" ? e.code : "failed";
  const kind =
    code === "service-unavailable" || code === "transport-unavailable" ? "unavailable" : "refused";
  const msg = String(e?.message ?? "").replace(/\.$/, "");
  let line = `mida: ${kind} (${code}) — ${msg}. Nothing was ${verb}.`;
  if (code === "rate-limited") line += " One write per minute per agent: wait and run again.";
  return line;
}

// The section-7.2 content: ASSAY's own interop file shape plus body, salt, output, messages,
// savedAt — all of it inside the record's encrypted body. `anchor` is the configured
// ReceiptAnchor address (the writer asserts the anchor it verified against). No `type` key.
export function buildRecord({ run, anchored, jwks, host, anchor, now }) {
  const m = AGENT_ID.exec(anchored.body?.host?.agentId ?? "");
  if (!m) {
    throw new RecordError(
      "assay: the receipt body's host.agentId is not erc8004:<chainId>:<agentId>. Nothing was written.",
    );
  }
  return {
    assayReceipt: 1,
    chainId: run.chainId,
    receiptHash: run.receiptHash,
    body: anchored.body,
    jws: anchored.jws,
    jwks,
    anchor: {
      contract: anchor,
      agentId: Number(m[2]),
      root: anchored.root,
      proof: anchored.proof,
      tx: anchored.anchorTx,
    },
    salt: run.salt,
    output: run.output,
    ...(run.messages !== undefined ? { messages: run.messages } : {}),
    source: `${host}/v1/receipts/${run.receiptHash}`,
    savedAt: new Date(now ? now() : Date.now()).toISOString(),
  };
}

// R4: who wrote a record is a chain fact — `source` and `author` on the item, never the content.
export function isWrittenBy(item, writerName) {
  return (
    item?.source === "AGENT_INFERRED" &&
    BYTES32.test(item?.author?.id ?? "") &&
    item.author.id.toLowerCase() !== ZERO_AUTHOR &&
    item?.author?.name === writerName
  );
}

// The newest item whose content marks it as a receipt record the writer wrote. Items arrive
// most-recently-anchored first, so the first match in walk order is the newest.
export function pickRecord(items, { writerName, receiptHash } = {}) {
  const want = typeof receiptHash === "string" ? receiptHash.toLowerCase() : undefined;
  for (const item of items ?? []) {
    const c = item?.content;
    if (!isObj(c) || c.assayReceipt !== 1) continue;
    if (!isWrittenBy(item, writerName)) continue;
    if (want !== undefined && String(c.receiptHash ?? "").toLowerCase() !== want) continue;
    return item;
  }
  return null;
}

// Pages of projects.current, most-recent first, until the cursor runs out or `until(items)`
// matches. `partial` stops the walk — the list may not be whole.
export async function walkItems(mida, until) {
  const items = [];
  let cursor;
  for (;;) {
    const page = await mida.context({
      namespace: NAMESPACE,
      limit: PAGE_LIMIT,
      ...(cursor ? { cursor } : {}),
    });
    if (page?.partial === true) throw new PartialListError();
    items.push(...(page?.items ?? []));
    if (until && until(items)) return items;
    cursor = page?.cursor ?? null;
    if (!cursor) return items;
  }
}

const unusable = (item, field, why) =>
  new RecordError(
    `read: record ${short(item?.id)} is not a usable receipt record (${field}: ${why}). Nothing was handed on.`,
  );

// R5: copy only the allow-listed fields, each validated. `id`, `author` and `writtenAt` always
// come from the item — the chain — never from the content.
export function parseRecord(item, config) {
  const c = item?.content;
  if (!isObj(c)) throw unusable(item, "content", "not an object");
  if (c.assayReceipt !== 1) throw unusable(item, "assayReceipt", "is not 1");
  if (c.chainId !== config.chainId) {
    throw unusable(item, "chainId", `is ${c.chainId}, this reader checks chain ${config.chainId}`);
  }
  if (!BYTES32.test(c.receiptHash ?? "")) throw unusable(item, "receiptHash", "not 32-byte hex");
  if (!isObj(c.body)) throw unusable(item, "body", "not an object");
  const jwsParts = typeof c.jws === "string" ? c.jws.split(".") : [];
  if (jwsParts.length !== 3 || jwsParts.some((p) => p === "")) {
    throw unusable(item, "jws", "not a three-part string");
  }
  if (!Array.isArray(c.jwks?.keys)) throw unusable(item, "jwks", "jwks.keys is not an array");
  const a = c.anchor;
  if (!isObj(a)) throw unusable(item, "anchor", "not an object");
  if (
    typeof a.contract !== "string" ||
    a.contract.toLowerCase() !== String(config.receiptAnchor).toLowerCase()
  ) {
    throw new RecordError(
      `read: record ${short(item.id)} names ReceiptAnchor ${a.contract}, but this reader checks ${config.receiptAnchor}. Nothing was handed on.`,
    );
  }
  if (!BYTES32.test(a.root ?? "")) throw unusable(item, "anchor.root", "not 32-byte hex");
  if (!Array.isArray(a.proof) || !a.proof.every((p) => BYTES32.test(p))) {
    throw unusable(item, "anchor.proof", "not an array of 32-byte hex");
  }
  if (!BYTES32.test(c.salt ?? "")) throw unusable(item, "salt", "not 32-byte hex");
  if (typeof c.output !== "string") throw unusable(item, "output", "not a string");
  if (c.messages !== undefined && !Array.isArray(c.messages)) {
    throw unusable(item, "messages", "not an array");
  }
  const record = {
    assayReceipt: 1,
    chainId: c.chainId,
    receiptHash: c.receiptHash,
    body: c.body,
    jws: c.jws,
    jwks: c.jwks,
    anchor: { contract: a.contract, agentId: a.agentId, root: a.root, proof: a.proof, tx: a.tx },
    salt: c.salt,
    output: c.output,
    ...(c.messages !== undefined ? { messages: c.messages } : {}),
    source: c.source,
    savedAt: c.savedAt,
  };
  return { id: item.id, author: item.author, writtenAt: item.writtenAt, record };
}

// Exactly their VerifyInput: the chain client and contract come from config, never the record.
// `params` is never set — their check takes it from the signed body.
export function toVerifyInput(record, { client, anchor }) {
  const input = {
    body: record.body,
    jws: record.jws,
    jwks: record.jwks,
    proof: record.anchor.proof,
    root: record.anchor.root,
    onchain: { client, anchor },
    salt: record.salt,
    output: record.output,
  };
  if (record.messages !== undefined) input.messages = record.messages;
  return input;
}

// R4 + R5 as one call — the entry point ASSAY's own check can import: the allow-listed record
// plus the item (the author and time the chain recorded). null when nothing qualifies.
export async function readAssayRecord(mida, config, { receiptHash } = {}) {
  let match;
  await walkItems(mida, (items) => {
    match = pickRecord(items, { writerName: config.writerAgent, receiptHash });
    return match != null;
  });
  if (!match) return null;
  return { item: match, ...parseRecord(match, config) };
}
