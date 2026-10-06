import path from "node:path";
import { getAddress } from "viem";

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
    this.exitCode = 1;
  }
}

const AGENT_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ERC8004_ID = /^erc8004:\d+:\d+$/;
const WHOLE_NUMBER = /^\d+$/;

const FOLDER = path.resolve(import.meta.dirname, "..");
const SDK_DEFAULT = path.resolve(import.meta.dirname, "../../../sdk");

const invalid = (key, expected) =>
  new ConfigError(`config: ${key} is missing or invalid (${expected}). Nothing was done.`);

function httpUrl(env, key, fallback) {
  const value = env[key];
  if (value === undefined || value === "") return fallback;
  try {
    const u = new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw invalid(key, "an http or https URL");
    return value.replace(/\/+$/, "");
  } catch (e) {
    if (e instanceof ConfigError) throw e;
    throw invalid(key, "an http or https URL");
  }
}

export function loadConfig(env = {}) {
  const midaHome = env.MIDA_HOME;
  if (typeof midaHome !== "string" || !path.isAbsolute(midaHome)) {
    throw invalid("MIDA_HOME", "an absolute path");
  }

  const writerAgent = env.ASSAY_WRITER_AGENT || "assay-writer";
  if (!AGENT_NAME.test(writerAgent)) {
    throw invalid("ASSAY_WRITER_AGENT", "1–40 lowercase letters, digits or dashes");
  }
  const readerAgent = env.ASSAY_READER_AGENT || "assay-reader";
  if (!AGENT_NAME.test(readerAgent)) {
    throw invalid("ASSAY_READER_AGENT", "1–40 lowercase letters, digits or dashes");
  }
  if (readerAgent === writerAgent) {
    throw new ConfigError(
      "config: ASSAY_READER_AGENT and ASSAY_WRITER_AGENT must be different agents (a record cannot vouch for itself). Nothing was done.",
    );
  }

  let projectDir = FOLDER;
  const project = env.MIDA_PROJECT;
  if (project !== undefined && project !== "") {
    if (!path.isAbsolute(project)) throw invalid("MIDA_PROJECT", "an absolute path");
    projectDir = project;
  }

  const host = httpUrl(env, "ASSAY_HOST", "https://34-45-1-81.sslip.io");

  let receiptAnchor = "0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24";
  if (env.ASSAY_RECEIPT_ANCHOR) {
    try {
      receiptAnchor = getAddress(env.ASSAY_RECEIPT_ANCHOR);
    } catch {
      throw invalid("ASSAY_RECEIPT_ANCHOR", "a 0x address");
    }
  }

  let trustedHosts = ["erc8004:10143:1962"];
  if (env.ASSAY_TRUSTED_HOSTS !== undefined) {
    const parts = env.ASSAY_TRUSTED_HOSTS.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0 || !parts.every((p) => ERC8004_ID.test(p))) {
      throw invalid("ASSAY_TRUSTED_HOSTS", "comma-separated erc8004:<chainId>:<agentId> values");
    }
    trustedHosts = parts;
  }

  let chainId = 10143;
  if (env.ASSAY_CHAIN_ID !== undefined && env.ASSAY_CHAIN_ID !== "") {
    if (!WHOLE_NUMBER.test(env.ASSAY_CHAIN_ID) || Number(env.ASSAY_CHAIN_ID) < 1) {
      throw invalid("ASSAY_CHAIN_ID", "a whole number");
    }
    chainId = Number(env.ASSAY_CHAIN_ID);
  }

  let sdkDir = SDK_DEFAULT;
  if (env.ASSAY_SDK_DIR) {
    sdkDir = path.isAbsolute(env.ASSAY_SDK_DIR)
      ? env.ASSAY_SDK_DIR
      : path.resolve(FOLDER, env.ASSAY_SDK_DIR);
  }

  const rpcUrl = httpUrl(env, "MONAD_RPC_URL", "https://testnet-rpc.monad.xyz");

  return {
    midaHome,
    writerAgent,
    readerAgent,
    projectDir,
    host,
    receiptAnchor,
    trustedHosts,
    chainId,
    sdkDir,
    rpcUrl,
  };
}
