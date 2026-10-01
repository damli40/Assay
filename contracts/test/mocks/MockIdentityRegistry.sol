// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IIdentityRegistry} from "../../src/interfaces/IIdentityRegistry.sol";

contract MockIdentityRegistry is IIdentityRegistry {
    mapping(uint256 agentId => address owner) public ownerOf;
    uint256 public lastId;

    function register(string calldata) external returns (uint256 agentId) {
        agentId = ++lastId;
        ownerOf[agentId] = msg.sender;
    }
}
