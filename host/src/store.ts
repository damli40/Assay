import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, truncateSync } from "node:fs";
import { join } from "node:path";
import type { ReceiptBody } from "@assay/receipts";
import type { Hex } from "viem";

export interface StoredReceipt {
  hash: Hex;
  body: ReceiptBody;
  jws: string;
}

export interface StoredBatch {
  root: Hex;
  count: number;
  anchorTx: Hex;
  proofs: Record<Hex, Hex[]>;
  anchoredAt: number;
}

/// Append-only JSONL files, replayed on start. One process owns the directory.
export class Store {
  private receipts = new Map<Hex, StoredReceipt>();
  private batchOf = new Map<Hex, StoredBatch>();
  private queue: Hex[] = [];
  private readonly receiptsFile: string;
  private readonly batchesFile: string;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.receiptsFile = join(dir, "receipts.jsonl");
    this.batchesFile = join(dir, "batches.jsonl");
    for (const r of readJsonl<StoredReceipt>(this.receiptsFile)) this.receipts.set(r.hash, r);
    for (const b of readJsonl<StoredBatch>(this.batchesFile)) this.indexBatch(b);
    this.queue = [...this.receipts.keys()].filter((h) => !this.batchOf.has(h));
  }

  addReceipt(r: StoredReceipt): void {
    appendFileSync(this.receiptsFile, JSON.stringify(r) + "\n");
    this.receipts.set(r.hash, r);
    this.queue.push(r.hash);
  }

  addBatch(b: StoredBatch): void {
    appendFileSync(this.batchesFile, JSON.stringify(b) + "\n");
    this.indexBatch(b);
    this.queue = this.queue.filter((h) => !this.batchOf.has(h));
  }

  getReceipt(hash: Hex): StoredReceipt | undefined {
    return this.receipts.get(hash.toLowerCase() as Hex);
  }

  getBatch(hash: Hex): StoredBatch | undefined {
    return this.batchOf.get(hash.toLowerCase() as Hex);
  }

  /// Receipt hashes not yet in an anchored batch, oldest first.
  pending(): Hex[] {
    return [...this.queue];
  }

  private indexBatch(b: StoredBatch): void {
    for (const h of Object.keys(b.proofs) as Hex[]) this.batchOf.set(h, b);
  }
}

function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, "utf8").split("\n");
  // A crash mid-append leaves a partial last line with no newline. That request was never answered, so drop it.
  const tail = lines.pop() ?? "";
  if (tail) {
    console.warn(`[store] dropping partial last line in ${file}`);
    truncateSync(file, statSync(file).size - Buffer.byteLength(tail));
  }
  return lines.filter((l) => l.trim()).map((l) => JSON.parse(l) as T);
}
