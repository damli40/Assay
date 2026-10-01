// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";

/// Anchors Merkle roots of Assay receipt batches, signed by each host's P-256 key (SPEC section 3).
contract ReceiptAnchor {
    bytes32 public constant ANCHOR_TAG = keccak256("assay-anchor/0");

    struct HostKey {
        bytes32 qx;
        bytes32 qy;
    }

    struct Anchor {
        uint256 agentId;
        uint32 count;
        uint64 anchoredAt;
    }

    IIdentityRegistry public immutable identity;
    bool public immutable requireUV;

    mapping(uint256 agentId => HostKey) public hostKeys;
    mapping(bytes32 root => Anchor) public anchors;

    event HostKeySet(uint256 indexed agentId, bytes32 indexed keyHash, bytes32 qx, bytes32 qy);
    event Anchored(uint256 indexed agentId, bytes32 indexed root, uint32 count, bytes32 keyHash);

    error NotAgentOwner();
    error InvalidPublicKey();
    error UnknownHost();
    error EmptyBatch();
    error RootAlreadyAnchored();
    error BadHostSignature();

    constructor(IIdentityRegistry identity_, bool requireUV_) {
        identity = identity_;
        requireUV = requireUV_;
    }

    function setHostKey(uint256 agentId, bytes32 qx, bytes32 qy) external {
        if (identity.ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        // Also rejects (0, 0), which marks "no key" in hostKeys.
        if (!P256.isValidPublicKey(qx, qy)) revert InvalidPublicKey();

        hostKeys[agentId] = HostKey(qx, qy);
        emit HostKeySet(agentId, keyHashOf(qx, qy), qx, qy);
    }

    function anchorMessage(uint256 agentId, bytes32 root, uint32 count) public view returns (bytes memory) {
        return abi.encode(ANCHOR_TAG, block.chainid, address(this), agentId, root, count);
    }

    /// Anyone can relay: authority is the host's signature. `s` must be low (s <= N/2).
    function anchor(uint256 agentId, bytes32 root, uint32 count, bytes32 r, bytes32 s) external {
        HostKey memory key = hostKeys[agentId];
        if (key.qx == 0 && key.qy == 0) revert UnknownHost();
        if (count == 0) revert EmptyBatch();
        if (anchors[root].anchoredAt != 0) revert RootAlreadyAnchored();

        // ES256 signs sha256(message).
        bytes32 digest = sha256(anchorMessage(agentId, root, count));
        if (!P256.verify(digest, r, s, key.qx, key.qy)) revert BadHostSignature();

        anchors[root] = Anchor(agentId, count, uint64(block.timestamp));
        emit Anchored(agentId, root, count, keyHashOf(key.qx, key.qy));
    }

    function verifyReceipt(bytes32 receiptHash, bytes32[] calldata proof, bytes32 root) external view returns (bool) {
        if (anchors[root].anchoredAt == 0) return false;
        return MerkleProof.verifyCalldata(proof, root, leafOf(receiptHash));
    }

    /// StandardMerkleTree ["bytes32"] leaf. The double hash keeps leaves distinct from inner nodes.
    function leafOf(bytes32 receiptHash) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(receiptHash))));
    }

    function keyHashOf(bytes32 qx, bytes32 qy) public pure returns (bytes32) {
        return keccak256(abi.encode(qx, qy));
    }
}
