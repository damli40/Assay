import { createSecp256k1SigningSession } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { reputationAbi, sponsoredCallTypedData, randomNonce, type ReceiptBody } from "@assay/receipts";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { bytesToHex, encodeFunctionData, hexToBytes, sha256, stringToBytes, type Address, type Hex } from "viem";
import type { SponsoredFeedback } from "./host.js";

// Three PRF namespaces, one primitive each: an encryption key, a signing identity, a disclosure key.
export const VAULT_LABEL = "assay:vault:v1";
export const requesterLabel = (appId: string) => `assay:requester:${appId}`;
export const revealLabel = (receiptHash: Hex) => `assay:reveal:${receiptHash.toLowerCase()}`;

/// The 32-byte PRF salt for a namespace: sha256(utf8(label)).
export const prfSalt = (label: string): Uint8Array => sha256(stringToBytes(label), "bytes");

const buf = (u: Uint8Array) => u as Uint8Array<ArrayBuffer>;

function assertPrf(prf: Uint8Array) {
  if (prf.length !== 32) throw new Error("PRF output must be 32 bytes");
}

/// HKDF-SHA256(prf, info = label) → 32 bytes for AES-256-GCM. The label in `info` keeps keys apart even if two PRF outputs collided.
export async function deriveKeyBytes(prf: Uint8Array, label: string): Promise<Uint8Array> {
  assertPrf(prf);
  const ikm = await crypto.subtle.importKey("raw", buf(prf), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: buf(stringToBytes(`${label}/aes-256-gcm`)) },
    ikm,
    256,
  );
  return new Uint8Array(bits);
}

export interface Sealed {
  iv: Hex;
  ct: Hex;
}

const aesKey = (raw: Uint8Array) => crypto.subtle.importKey("raw", buf(raw), "AES-GCM", false, ["encrypt", "decrypt"]);

/// AES-256-GCM with the label as associated data, so a ciphertext can't be replayed under another namespace.
export async function seal(raw: Uint8Array, label: string, value: unknown): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: buf(stringToBytes(label)) },
    await aesKey(raw),
    buf(stringToBytes(JSON.stringify(value))),
  );
  return { iv: bytesToHex(iv), ct: bytesToHex(new Uint8Array(ct)) };
}

export async function open<T>(raw: Uint8Array, label: string, sealed: Sealed): Promise<T> {
  let pt: ArrayBuffer;
  try {
    pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: buf(hexToBytes(sealed.iv)), additionalData: buf(stringToBytes(label)) },
      await aesKey(raw),
      buf(hexToBytes(sealed.ct)),
    );
  } catch {
    throw new Error("Decryption failed: wrong key, wrong namespace or tampered data.");
  }
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

/// What the requester must keep to prove a receipt later. Only ever stored encrypted.
export interface VaultEntry {
  receiptHash: Hex;
  body: ReceiptBody;
  jws: string;
  salt: Hex;
  output?: string;
  messages?: unknown;
  savedAt: number;
}

async function withKey<T>(prf: Uint8Array, label: string, fn: (raw: Uint8Array) => Promise<T>): Promise<T> {
  const raw = await deriveKeyBytes(prf, label);
  try {
    return await fn(raw);
  } finally {
    raw.fill(0);
  }
}

export const sealVault = (prf: Uint8Array, entries: VaultEntry[]) => withKey(prf, VAULT_LABEL, (k) => seal(k, VAULT_LABEL, entries));
export const openVault = (prf: Uint8Array, sealed: Sealed) => withKey(prf, VAULT_LABEL, (k) => open<VaultEntry[]>(k, VAULT_LABEL, sealed));

/// One receipt's entry, sealed under that receipt's reveal key.
export interface Disclosure {
  receiptHash: Hex;
  sealed: Sealed;
}

/// The key to hand a third party. `prf` must come from the `assay:reveal:<receiptHash>` salt.
export async function revealKey(prf: Uint8Array, receiptHash: Hex): Promise<Hex> {
  const raw = await deriveKeyBytes(prf, revealLabel(receiptHash));
  const hex = bytesToHex(raw);
  raw.fill(0);
  return hex;
}

export async function sealDisclosure(key: Hex, entry: VaultEntry): Promise<Disclosure> {
  return { receiptHash: entry.receiptHash, sealed: await seal(hexToBytes(key), revealLabel(entry.receiptHash), entry) };
}

export const openDisclosure = (key: Hex, d: Disclosure) => open<VaultEntry>(hexToBytes(key), revealLabel(d.receiptHash), d.sealed);

/// PRF output → BIP-39 entropy → seed → m/44'/60'/0'/0/0, the path Mera documents. The caller must zero the result.
export function requesterPrivateKey(prf: Uint8Array): Uint8Array {
  assertPrf(prf);
  const node = HDKey.fromMasterSeed(mnemonicToSeedSync(entropyToMnemonic(prf, wordlist))).derive("m/44'/60'/0'/0/0");
  if (!node.privateKey) throw new Error("BIP-32 derivation gave no private key");
  const pk = Uint8Array.from(node.privateKey);
  node.wipePrivateData();
  return pk;
}

/// Runs `fn` with a one-shot Mera session; the key is zeroed when it returns or throws.
async function withRequester<T>(prf: Uint8Array, fn: (account: ReturnType<typeof toViemAccount>) => Promise<T>): Promise<T> {
  const pk = requesterPrivateKey(prf);
  const session = createSecp256k1SigningSession({ privateKey: pk });
  pk.fill(0);
  try {
    return await fn(toViemAccount(session));
  } finally {
    session.end();
  }
}

export const requesterAddress = (prf: Uint8Array): Promise<Address> => withRequester(prf, async (a) => a.address);

/// EIP-191 over the raw 32-byte receipt hash, as ReceiptAnchor.cosignK recovers it.
export const signReceiptHash = (prf: Uint8Array, receiptHash: Hex): Promise<{ address: Address; signature: Hex }> =>
  withRequester(prf, async (a) => ({ address: a.address, signature: await a.signMessage({ message: { raw: receiptHash } }) }));

/// A complaint (or praise) about a host, filed from the per-app address with the host paying the gas.
/// It cites the receipt by hash, so the indexer counts it as receipt-backed once this address has co-signed it.
/// `delegationNonce` is the account's transaction count; pass it only when the account isn't delegated yet.
export async function signSponsoredFeedback(
  prf: Uint8Array,
  o: { chainId: number; accountImpl: Address; reputation: Address; agentId: bigint; receiptHash: Hex; value: -1 | 1; note: string; nowSeconds: number; delegationNonce?: number },
): Promise<SponsoredFeedback> {
  const data = encodeFunctionData({ abi: reputationAbi, functionName: "giveFeedback", args: [o.agentId, BigInt(o.value), 0, "assay", "receipt", "", o.note.slice(0, 200), o.receiptHash] });
  return withRequester(prf, async (a) => {
    const call = { target: o.reputation, data, nonce: randomNonce(), deadline: BigInt(o.nowSeconds + 600) };
    const signature = await a.signTypedData(sponsoredCallTypedData(o.chainId, a.address, call));
    const auth = o.delegationNonce === undefined ? undefined : await a.signAuthorization!({ chainId: o.chainId, contractAddress: o.accountImpl, nonce: o.delegationNonce });
    return {
      account: a.address,
      call: { data, nonce: call.nonce.toString(), deadline: call.deadline.toString(), signature },
      ...(auth ? { authorization: { address: o.accountImpl, chainId: o.chainId, nonce: o.delegationNonce!, r: auth.r, s: auth.s, yParity: auth.yParity ?? 0 } } : {}),
    };
  });
}
