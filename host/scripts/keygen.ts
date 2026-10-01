// Generates the host's ES256 key. Usage: tsx scripts/keygen.ts [path]  (default host/.keys/host.jwk.json)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { calculateJwkThumbprint, exportJWK, generateKeyPair } from "jose";
import { encodeAbiParameters, keccak256, toHex } from "viem";

const path = resolve(fileURLToPath(new URL("..", import.meta.url)), process.argv[2] ?? process.env.HOST_JWK_PATH ?? ".keys/host.jwk.json");

const { privateKey } = await generateKeyPair("ES256", { extractable: true });
const jwk = await exportJWK(privateKey);
const kid = await calculateJwkThumbprint(jwk);

mkdirSync(dirname(path), { recursive: true });
try {
  // "wx" fails if the file exists: overwriting would orphan every receipt the old key signed.
  writeFileSync(path, JSON.stringify({ ...jwk, kid, alg: "ES256" }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
} catch (e) {
  if ((e as NodeJS.ErrnoException).code === "EEXIST") {
    console.error(`${path} already exists. Move it to a retired path (RETIRED_JWK_PATHS) before generating a new key.`);
    process.exit(1);
  }
  throw e;
}

const b32 = (b64url: string) => toHex(Buffer.from(b64url, "base64url"), { size: 32 });
const qx = b32(jwk.x!);
const qy = b32(jwk.y!);
console.log(`wrote ${path}`);
console.log(`kid     ${kid}`);
console.log(`qx      ${qx}`);
console.log(`qy      ${qy}`);
console.log(`keyHash ${keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [qx, qy]))}`);
