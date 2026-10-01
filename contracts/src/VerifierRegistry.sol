// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";

/// Open registry of host grades (SPEC section 5). Anyone with an ERC-8004 identity can post grades,
/// and readers choose which verifiers to trust through `gradeOf`.
contract VerifierRegistry {
    struct Grade {
        bytes32 model;
        bytes32 hostKey;
        bytes32 checks;
        uint32 passed;
        uint32 total;
        uint16 ciLowBps;
        uint16 ciHighBps;
        bytes32 refModel;
        bytes32 evidence;
        uint64 t;
    }

    IIdentityRegistry public immutable identity;

    mapping(address verifier => uint256 agentId) public verifierAgentId;
    mapping(address verifier => mapping(bytes32 model => mapping(bytes32 hostKey => Grade))) internal latest;

    event VerifierRegistered(address indexed verifier, uint256 indexed agentId);
    event GradePosted(
        address indexed verifier,
        uint256 indexed verifierAgentId,
        bytes32 indexed model,
        bytes32 hostKey,
        uint32 passed,
        uint32 total,
        uint16 ciLowBps,
        uint16 ciHighBps,
        bytes32 checks,
        bytes32 refModel,
        bytes32 evidence,
        uint64 t
    );

    error NotAgentOwner();
    error NotVerifier();
    error BadCounts();
    error BadInterval();
    error FutureTimestamp();
    error StaleGrade();

    constructor(IIdentityRegistry identity_) {
        identity = identity_;
    }

    function registerVerifier(uint256 agentId) external {
        if (identity.ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        verifierAgentId[msg.sender] = agentId;
        emit VerifierRegistered(msg.sender, agentId);
    }

    function postGrade(Grade calldata g) external {
        uint256 agentId = verifierAgentId[msg.sender];
        // Re-checked on every post: an ERC-8004 identity is an NFT and can change hands.
        if (agentId == 0 || identity.ownerOf(agentId) != msg.sender) revert NotVerifier();
        if (g.total == 0 || g.passed > g.total) revert BadCounts();
        if (g.ciLowBps > g.ciHighBps || g.ciHighBps > 10_000) revert BadInterval();
        // Validator clock skew of a few seconds is irrelevant for grade timestamps.
        // forge-lint: disable-next-line(block-timestamp)
        if (g.t > block.timestamp) revert FutureTimestamp();

        if (g.t <= latest[msg.sender][g.model][g.hostKey].t) revert StaleGrade();
        latest[msg.sender][g.model][g.hostKey] = g;

        emit GradePosted(
            msg.sender,
            agentId,
            g.model,
            g.hostKey,
            g.passed,
            g.total,
            g.ciLowBps,
            g.ciHighBps,
            g.checks,
            g.refModel,
            g.evidence,
            g.t
        );
    }

    function latestGrade(address verifier, bytes32 model, bytes32 hostKey) external view returns (Grade memory) {
        return latest[verifier][model][hostKey];
    }

    /// Newest grade for (model, hostKey) among `trusted`. Returns an empty grade and address(0) if none.
    /// On equal timestamps the verifier listed first wins.
    function gradeOf(bytes32 model, bytes32 hostKey, address[] calldata trusted)
        external
        view
        returns (Grade memory g, address by)
    {
        for (uint256 i; i < trusted.length; i++) {
            Grade storage candidate = latest[trusted[i]][model][hostKey];
            if (candidate.t > g.t) {
                g = candidate;
                by = trusted[i];
            }
        }
    }
}
