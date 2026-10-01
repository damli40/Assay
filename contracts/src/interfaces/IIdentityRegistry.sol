// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Subset of the ERC-8004 IdentityRegistry (Monad testnet: 0x8004A818BFB912233c491871b3d84c89A494BD9e).
interface IIdentityRegistry {
    function ownerOf(uint256 agentId) external view returns (address);
}
