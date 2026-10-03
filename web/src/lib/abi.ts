import { parseAbi } from "viem";

/// Fragments the SDK doesn't export.
export const verifierRegistryAbi = parseAbi(["function verifierAgentId(address verifier) view returns (uint256)"]);
export const identityRegistryAbi = parseAbi(["function ownerOf(uint256 agentId) view returns (address)"]);
export const creAttestorAbi = parseAbi(["event Configured(address indexed forwarder, address indexed workflowOwner, bytes32 workflowId)"]);
