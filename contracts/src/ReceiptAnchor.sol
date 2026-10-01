// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";

/// Anchors batches of Assay receipts on Monad (SPEC section 3).
/// A host registers a P-256 key against its ERC-8004 identity, signs the Merkle root of a batch
/// of receipt hashes, and anyone can relay that signature here. Anyone can then prove a single
/// receipt belongs to an anchored batch with a Merkle proof.
contract ReceiptAnchor {
    /// Domain tag for the anchor message. Bump the version if the message layout ever changes.
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
    /// Used by the requester co-sign path (Day 3). Set at deploy so the constructor stays stable.
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

    /// Registers or rotates the P-256 key that signs anchors for `agentId`.
    /// Only the ERC-8004 owner of the agent may call this. Rotating a key leaves old anchors valid,
    /// and each Anchored event records which key signed it.
    function setHostKey(uint256 agentId, bytes32 qx, bytes32 qy) external {
        if (identity.ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        // Rejects points that are not on the curve, including (0, 0), which we use as "no key".
        if (!P256.isValidPublicKey(qx, qy)) revert InvalidPublicKey();

        hostKeys[agentId] = HostKey(qx, qy);
        emit HostKeySet(agentId, keyHashOf(qx, qy), qx, qy);
    }

    /// The exact bytes a host signs (ES256) to anchor a batch. Chain id and contract address stop
    /// replay on other chains or deployments, and `count` stops a relayer from misreporting the batch.
    function anchorMessage(uint256 agentId, bytes32 root, uint32 count) public view returns (bytes memory) {
        return abi.encode(ANCHOR_TAG, block.chainid, address(this), agentId, root, count);
    }

    /// Anchors a batch root. Anyone can relay: authority comes from the host's signature, not msg.sender.
    /// `s` must be low (s <= N/2). WebCrypto signers have to normalize before calling.
    function anchor(uint256 agentId, bytes32 root, uint32 count, bytes32 r, bytes32 s) external {
        HostKey memory key = hostKeys[agentId];
        if (key.qx == 0 && key.qy == 0) revert UnknownHost();
        if (count == 0) revert EmptyBatch();
        if (anchors[root].anchoredAt != 0) revert RootAlreadyAnchored();

        // ES256 signs sha256(message), so the contract rebuilds the same digest.
        bytes32 digest = sha256(anchorMessage(agentId, root, count));
        if (!P256.verify(digest, r, s, key.qx, key.qy)) revert BadHostSignature();

        anchors[root] = Anchor(agentId, count, uint64(block.timestamp));
        emit Anchored(agentId, root, count, keyHashOf(key.qx, key.qy));
    }

    /// Returns true if `receiptHash` is a leaf of `root` and `root` has been anchored.
    /// Returns false instead of reverting so callers can use it as a plain check.
    function verifyReceipt(bytes32 receiptHash, bytes32[] calldata proof, bytes32 root) external view returns (bool) {
        if (anchors[root].anchoredAt == 0) return false;
        return MerkleProof.verifyCalldata(proof, root, leafOf(receiptHash));
    }

    /// Leaf encoding of OpenZeppelin's StandardMerkleTree with leaf type ["bytes32"].
    /// Hashing twice keeps leaves distinct from inner nodes (second-preimage protection).
    function leafOf(bytes32 receiptHash) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(receiptHash))));
    }

    /// Compact id for a host key, used in events and as `hostKey` in grades (SPEC section 7, note 6).
    function keyHashOf(bytes32 qx, bytes32 qy) public pure returns (bytes32) {
        return keccak256(abi.encode(qx, qy));
    }
}
