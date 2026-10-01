// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";

/// Anchors Merkle roots of Assay receipt batches, signed by each host's P-256 key (SPEC section 3).
contract ReceiptAnchor {
    bytes32 public constant ANCHOR_TAG = keccak256("assay-anchor/0");

    struct HostKey {
        bytes32 qx;
        bytes32 qy;
    }

    struct Anchor {
        uint32 count;
        uint64 anchoredAt;
    }

    IIdentityRegistry public immutable identity;
    bool public immutable requireUV;

    mapping(uint256 agentId => HostKey) public hostKeys;
    // Keyed per host: any host can sign any root, so a global key would let one host block another's anchor.
    mapping(uint256 agentId => mapping(bytes32 root => Anchor)) public anchors;
    // Keyed per requester key: any passkey can sign any challenge, so one slot per receipt could be front-run.
    mapping(bytes32 receiptHash => mapping(bytes32 requesterKey => bool)) public cosigned;

    event HostKeySet(uint256 indexed agentId, bytes32 indexed keyHash, bytes32 qx, bytes32 qy);
    event Anchored(uint256 indexed agentId, bytes32 indexed root, uint32 count, bytes32 keyHash);
    event Cosigned(bytes32 indexed receiptHash, bytes32 indexed requesterKey, uint256 indexed agentId, bytes32 root);

    error NotAgentOwner();
    error InvalidPublicKey();
    error UnknownHost();
    error EmptyBatch();
    error RootAlreadyAnchored();
    error BadHostSignature();
    error ReceiptNotAnchored();
    error AlreadyCosigned();
    error BadCosignature();

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
        if (anchors[agentId][root].anchoredAt != 0) revert RootAlreadyAnchored();

        // ES256 signs sha256(message).
        bytes32 digest = sha256(anchorMessage(agentId, root, count));
        if (!P256.verify(digest, r, s, key.qx, key.qy)) revert BadHostSignature();

        anchors[agentId][root] = Anchor(count, uint64(block.timestamp));
        emit Anchored(agentId, root, count, keyHashOf(key.qx, key.qy));
    }

    function verifyReceipt(uint256 agentId, bytes32 receiptHash, bytes32[] calldata proof, bytes32 root)
        public
        view
        returns (bool)
    {
        if (anchors[agentId][root].anchoredAt == 0) return false;
        return MerkleProof.verifyCalldata(proof, root, leafOf(receiptHash));
    }

    /// Records a requester's passkey co-signature over an anchored receipt (SPEC section 4).
    /// Which key counts as "the requester" is decided offchain by `req.cosigner` in the receipt body.
    function cosign(
        uint256 agentId,
        bytes32 receiptHash,
        bytes32[] calldata proof,
        bytes32 root,
        WebAuthn.WebAuthnAuth calldata auth,
        bytes32 qx,
        bytes32 qy
    ) external {
        if (!verifyReceipt(agentId, receiptHash, proof, root)) revert ReceiptNotAnchored();
        bytes32 requesterKey = keyHashOf(qx, qy);
        if (cosigned[receiptHash][requesterKey]) revert AlreadyCosigned();
        if (!WebAuthn.verify(abi.encodePacked(receiptHash), auth, qx, qy, requireUV)) revert BadCosignature();

        cosigned[receiptHash][requesterKey] = true;
        emit Cosigned(receiptHash, requesterKey, agentId, root);
    }

    /// StandardMerkleTree ["bytes32"] leaf. The double hash keeps leaves distinct from inner nodes.
    function leafOf(bytes32 receiptHash) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(receiptHash))));
    }

    function keyHashOf(bytes32 qx, bytes32 qy) public pure returns (bytes32) {
        return keccak256(abi.encode(qx, qy));
    }
}
