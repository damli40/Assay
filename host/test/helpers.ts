import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHostSigner } from "@assay/receipts";
import { calculateJwkThumbprint, exportJWK, generateKeyPair } from "jose";
import { parseEther, type Hex } from "viem";
import type { ChainClient, WriteRequest } from "../src/chain.js";

export const tempDir = () => mkdtempSync(join(tmpdir(), "assay-host-"));

export async function newSigner() {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  const jwk = await exportJWK(privateKey);
  const kid = await calculateJwkThumbprint(jwk);
  return createHostSigner(jwk, kid);
}

export interface MockClient extends ChainClient {
  writes: (WriteRequest & { gas: bigint })[];
  estimates: number;
}

export function mockClient(opts: { fail?: boolean; revert?: boolean; balance?: bigint; gas?: bigint } = {}): MockClient {
  let n = 0;
  const c: MockClient = {
    writes: [],
    estimates: 0,
    async estimateContractGas() {
      c.estimates++;
      if (opts.fail) throw new Error("rpc down");
      return opts.gas ?? 61_000n;
    },
    async writeContract(req) {
      c.writes.push(req);
      return `0x${(++n).toString(16).padStart(64, "a")}` as Hex;
    },
    async waitForTransactionReceipt() {
      return { status: opts.revert ? "reverted" : "success" };
    },
    async getBalance() {
      return opts.balance ?? parseEther("5");
    },
  };
  return c;
}

export const quietLog = () => {
  const lines: string[] = [];
  const push = (...a: unknown[]) => void lines.push(a.join(" "));
  return { lines, info: push, warn: push, error: push };
};
