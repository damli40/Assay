import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssaySdkError, loadAssaySdk } from "../src/assay-sdk.js";

async function problem(promise) {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error("did not reject");
}

describe("loadAssaySdk", () => {
  it("refuses a dir with no dist/index.js, naming the two owner commands", async () => {
    const dir = await mkdtemp(join(tmpdir(), "assay-sdk-"));
    const e = await problem(loadAssaySdk(dir));
    expect(e).toBeInstanceOf(AssaySdkError);
    expect(e.exitCode).toBe(1);
    expect(e.message).toBe(
      `assay: the ASSAY SDK is not built at ${dir}/dist. At the repository root run: corepack pnpm install --frozen-lockfile && corepack pnpm --filter @assay/receipts build. Nothing was done.`,
    );
  });

  it("loads a built dist/index.js", async () => {
    const dir = await mkdtemp(join(tmpdir(), "assay-sdk-"));
    await mkdir(join(dir, "dist"));
    await writeFile(join(dir, "dist", "index.js"), 'export const verifyReceipt = () => "x";\n');
    const mod = await loadAssaySdk(dir);
    expect(mod.verifyReceipt()).toBe("x");
  });

  it("refuses a dist that throws on import, naming the error class only", async () => {
    const dir = await mkdtemp(join(tmpdir(), "assay-sdk-"));
    await mkdir(join(dir, "dist"));
    await writeFile(
      join(dir, "dist", "index.js"),
      'throw new SyntaxError("a host or RPC body could be quoted here");\n',
    );
    const e = await problem(loadAssaySdk(dir));
    expect(e).toBeInstanceOf(AssaySdkError);
    expect(e.message.startsWith(`assay: the ASSAY SDK at ${dir}/dist could not be loaded (`)).toBe(true);
    expect(e.message).toContain("SyntaxError");
    expect(e.message).not.toContain("a host or RPC body could be quoted here");
  });
});
