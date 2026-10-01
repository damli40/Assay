import { createPasskeyWithPrfOutput, getPasskeyPrfOutput, isMeraError } from "@category-labs/mera";
import { openVault, prfSalt, sealVault, VAULT_LABEL, type Sealed, type VaultEntry } from "./lib/vault.js";

// Public data only: a credential id and ciphertext. PRF output and derived keys are never stored.
const CREDENTIAL = "assay.mera.credentialId";
const VAULT = "assay.vault.v1";

export const meraCredential = () => localStorage.getItem(CREDENTIAL);

/// One passkey prompt per call: PRF output for `label`, handed to `fn`, then zeroed.
export async function withPrf<T>(label: string, fn: (prf: Uint8Array) => Promise<T>): Promise<T> {
  const credentialId = meraCredential();
  const { credentialId: used, prfOutput } = await getPasskeyPrfOutput({
    rpId: location.hostname,
    prfSalt: prfSalt(label),
    credential: credentialId ? { credentialId } : undefined,
  });
  localStorage.setItem(CREDENTIAL, used);
  try {
    return await fn(prfOutput);
  } finally {
    prfOutput.fill(0);
  }
}

export async function createVaultPasskey(): Promise<string> {
  const { credentialId, prfOutput } = await createPasskeyWithPrfOutput({
    rp: { id: location.hostname, name: "Assay" },
    user: { name: "Assay vault", displayName: "Assay vault" },
    prfSalt: prfSalt(VAULT_LABEL),
  });
  prfOutput.fill(0);
  localStorage.setItem(CREDENTIAL, credentialId);
  return credentialId;
}

export function loadSealed(): Sealed | null {
  const raw = localStorage.getItem(VAULT);
  return raw ? (JSON.parse(raw) as Sealed) : null;
}

export const storeSealed = (s: Sealed) => localStorage.setItem(VAULT, JSON.stringify(s));

export const unlockVault = () => withPrf(VAULT_LABEL, async (prf) => {
  const sealed = loadSealed();
  return sealed ? openVault(prf, sealed) : [];
});

/// Decrypt, append, re-encrypt under one passkey prompt. Returns the new plaintext list for display only.
export const addToVault = (entry: VaultEntry) =>
  withPrf(VAULT_LABEL, async (prf) => {
    const sealed = loadSealed();
    const entries = (sealed ? await openVault(prf, sealed) : []).filter((e) => e.receiptHash !== entry.receiptHash);
    entries.push(entry);
    storeSealed(await sealVault(prf, entries));
    return entries;
  });

export function meraMessage(e: unknown): string {
  if (!isMeraError(e)) return e instanceof Error ? e.message : String(e);
  switch (e.code) {
    case "PRF_UNAVAILABLE":
      return "This passkey gave no PRF output. On desktop Chrome only passkeys saved to Google Password Manager support PRF; iCloud Keychain and 1Password also work. Create a vault passkey there and try again.";
    case "PASSKEY_OPERATION_FAILED":
      return "The passkey prompt was cancelled or failed. Try again.";
    case "CRYPTO_UNAVAILABLE":
      return "This browser lacks Web Crypto. Use a current browser over HTTPS or localhost.";
    case "SESSION_ENDED":
      return "The signing session had already ended. Try again.";
    default:
      return `${e.code}: ${e.message}`;
  }
}
