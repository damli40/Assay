import { getAddress, pad, type Address, type Hex } from "viem";

/// D25: `req.cosigner` for a secp256k1 requester (Mera per-app key, `cosignK`) is its address left-padded to 32 bytes.
/// A P-256 requester uses `requesterKeyHash(qx, qy)`; a keccak hash starting with 12 zero bytes has probability 2^-96.
export function cosignerForAddress(address: Address): Hex {
  return pad(getAddress(address), { size: 32 }).toLowerCase() as Hex;
}

/// The secp256k1 address a `req.cosigner` names, or null when it names a P-256 key hash.
export function cosignerAddress(cosigner: Hex): Address | null {
  const h = cosigner.toLowerCase();
  return /^0x0{24}[0-9a-f]{40}$/.test(h) ? getAddress(`0x${h.slice(26)}`) : null;
}
