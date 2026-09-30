// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// The one function Assay needs from the ERC-8004 IdentityRegistry (an ERC-721).
/// Monad testnet deployment: 0x8004A818BFB912233c491871b3d84c89A494BD9e.
interface IIdentityRegistry {
    function ownerOf(uint256 agentId) external view returns (address);
}
