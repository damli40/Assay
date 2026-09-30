// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ReceiptAnchor} from "../src/ReceiptAnchor.sol";
import {IIdentityRegistry} from "../src/interfaces/IIdentityRegistry.sol";
import {MockIdentityRegistry} from "./mocks/MockIdentityRegistry.sol";

contract ReceiptAnchorTest is Test {
    uint256 internal constant HOST_PK = 0xA11CE;
    uint256 internal constant OTHER_PK = 0xB0B;

    MockIdentityRegistry internal reg;
    ReceiptAnchor internal ra;
    address internal host = makeAddr("host");
    uint256 internal agentId;
    bytes32 internal qx;
    bytes32 internal qy;

    // A two-leaf batch small enough to build by hand: root = hash of the sorted pair of leaves.
    bytes32 internal constant RECEIPT_A = keccak256("receipt a");
    bytes32 internal constant RECEIPT_B = keccak256("receipt b");
    bytes32 internal root;

    function setUp() public {
        reg = new MockIdentityRegistry();
        ra = new ReceiptAnchor(IIdentityRegistry(address(reg)), true);

        (uint256 x, uint256 y) = vm.publicKeyP256(HOST_PK);
        (qx, qy) = (bytes32(x), bytes32(y));

        vm.startPrank(host);
        agentId = reg.register("");
        ra.setHostKey(agentId, qx, qy);
        vm.stopPrank();

        root = _pairRoot(ra.leafOf(RECEIPT_A), ra.leafOf(RECEIPT_B));
    }

    // Same hashing as OpenZeppelin's MerkleProof: sort the pair, then keccak256 of the 64 bytes.
    function _pairRoot(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    // Signs exactly what the host signs: sha256 of the contract's anchor message.
    function _sign(ReceiptAnchor target, uint256 pk, bytes32 r_, uint32 count)
        internal
        view
        returns (bytes32, bytes32)
    {
        return vm.signP256(pk, sha256(target.anchorMessage(agentId, r_, count)));
    }

    function _proof(bytes32 sibling) internal pure returns (bytes32[] memory p) {
        p = new bytes32[](1);
        p[0] = sibling;
    }

    function _anchor() internal {
        (bytes32 r, bytes32 s) = _sign(ra, HOST_PK, root, 2);
        ra.anchor(agentId, root, 2, r, s);
    }

    // ---------- anchor ----------

    function test_anchor_and_verifyReceipt() public {
        (bytes32 r, bytes32 s) = _sign(ra, HOST_PK, root, 2);

        vm.expectEmit(address(ra));
        emit ReceiptAnchor.Anchored(agentId, root, 2, ra.keyHashOf(qx, qy));
        vm.prank(makeAddr("relayer")); // anyone can relay
        ra.anchor(agentId, root, 2, r, s);

        (uint256 storedAgent, uint32 count, uint64 at) = ra.anchors(root);
        assertEq(storedAgent, agentId);
        assertEq(count, 2);
        assertEq(at, block.timestamp);

        assertTrue(ra.verifyReceipt(RECEIPT_A, _proof(ra.leafOf(RECEIPT_B)), root));
        assertTrue(ra.verifyReceipt(RECEIPT_B, _proof(ra.leafOf(RECEIPT_A)), root));
    }

    function test_anchor_wrongKey_reverts() public {
        (bytes32 r, bytes32 s) = _sign(ra, OTHER_PK, root, 2);
        vm.expectRevert(ReceiptAnchor.BadHostSignature.selector);
        ra.anchor(agentId, root, 2, r, s);
    }

    function test_anchor_unknownHost_reverts() public {
        vm.prank(host);
        uint256 keyless = reg.register("");
        (bytes32 r, bytes32 s) = _sign(ra, HOST_PK, root, 2);
        vm.expectRevert(ReceiptAnchor.UnknownHost.selector);
        ra.anchor(keyless, root, 2, r, s);
    }

    function test_anchor_emptyBatch_reverts() public {
        (bytes32 r, bytes32 s) = _sign(ra, HOST_PK, root, 0);
        vm.expectRevert(ReceiptAnchor.EmptyBatch.selector);
        ra.anchor(agentId, root, 0, r, s);
    }

    function test_anchor_replay_reverts() public {
        (bytes32 r, bytes32 s) = _sign(ra, HOST_PK, root, 2);
        ra.anchor(agentId, root, 2, r, s);
        vm.expectRevert(ReceiptAnchor.RootAlreadyAnchored.selector);
        ra.anchor(agentId, root, 2, r, s);
    }

    function test_anchor_otherDeployment_reverts() public {
        ReceiptAnchor other = new ReceiptAnchor(IIdentityRegistry(address(reg)), true);
        vm.prank(host);
        other.setHostKey(agentId, qx, qy);

        // Signed for `ra`, submitted to `other`. Same host, same key, same root.
        (bytes32 r, bytes32 s) = _sign(ra, HOST_PK, root, 2);
        vm.expectRevert(ReceiptAnchor.BadHostSignature.selector);
        other.anchor(agentId, root, 2, r, s);

        // Positive twin: a signature made for `other` is accepted there.
        (r, s) = _sign(other, HOST_PK, root, 2);
        other.anchor(agentId, root, 2, r, s);
    }

    function test_anchor_countTampered_reverts() public {
        (bytes32 r, bytes32 s) = _sign(ra, HOST_PK, root, 8);
        vm.expectRevert(ReceiptAnchor.BadHostSignature.selector);
        ra.anchor(agentId, root, 9, r, s);
    }

    function test_anchor_highS_reverts() public {
        uint256 n = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
        (bytes32 r, bytes32 s) = _sign(ra, HOST_PK, root, 2);
        vm.expectRevert(ReceiptAnchor.BadHostSignature.selector);
        ra.anchor(agentId, root, 2, r, bytes32(n - uint256(s)));
    }

    // ---------- setHostKey ----------

    function test_setHostKey_emits() public {
        (uint256 x, uint256 y) = vm.publicKeyP256(OTHER_PK);
        vm.expectEmit(address(ra));
        emit ReceiptAnchor.HostKeySet(agentId, ra.keyHashOf(bytes32(x), bytes32(y)), bytes32(x), bytes32(y));
        vm.prank(host);
        ra.setHostKey(agentId, bytes32(x), bytes32(y));
    }

    function test_setHostKey_nonOwner_reverts() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(ReceiptAnchor.NotAgentOwner.selector);
        ra.setHostKey(agentId, qx, qy);
    }

    function test_setHostKey_invalidPoint_reverts() public {
        vm.startPrank(host);
        vm.expectRevert(ReceiptAnchor.InvalidPublicKey.selector);
        ra.setHostKey(agentId, bytes32(uint256(1)), bytes32(uint256(2)));
        vm.expectRevert(ReceiptAnchor.InvalidPublicKey.selector);
        ra.setHostKey(agentId, 0, 0);
        vm.stopPrank();
    }

    function test_setHostKey_rotation_keepsOldAnchors() public {
        _anchor();
        (uint256 x, uint256 y) = vm.publicKeyP256(OTHER_PK);
        vm.prank(host);
        ra.setHostKey(agentId, bytes32(x), bytes32(y));

        assertTrue(ra.verifyReceipt(RECEIPT_A, _proof(ra.leafOf(RECEIPT_B)), root), "old anchor still valid");

        // The old key can no longer anchor new batches.
        bytes32 newRoot = keccak256("next batch");
        (bytes32 r, bytes32 s) = _sign(ra, HOST_PK, newRoot, 1);
        vm.expectRevert(ReceiptAnchor.BadHostSignature.selector);
        ra.anchor(agentId, newRoot, 1, r, s);
    }

    // ---------- verifyReceipt ----------

    function test_verifyReceipt_badProof_false() public {
        _anchor();
        bytes32 flipped = ra.leafOf(RECEIPT_B) ^ bytes32(uint256(1));
        assertFalse(ra.verifyReceipt(RECEIPT_A, _proof(flipped), root));
    }

    function test_verifyReceipt_unanchoredRoot_false() public view {
        // Correct proof, but nobody anchored the root.
        assertFalse(ra.verifyReceipt(RECEIPT_A, _proof(ra.leafOf(RECEIPT_B)), root));
    }

    function test_verifyReceipt_wrongLeaf_false() public {
        _anchor();
        // Proof for RECEIPT_A, asked about a receipt that was never in the batch.
        assertFalse(ra.verifyReceipt(keccak256("receipt c"), _proof(ra.leafOf(RECEIPT_B)), root));
    }

    // ---------- leafOf ----------

    function test_leafOf_knownVector() public view {
        // From @openzeppelin/merkle-tree 1.0.8: StandardMerkleTree.of([[0x00..01]], ["bytes32"]).root,
        // which for a one-leaf tree is the leaf hash itself. Fixtures.t.sol checks 8 more leaves.
        assertEq(ra.leafOf(bytes32(uint256(1))), 0xb5d9d894133a730aa651ef62d26b0ffa846233c74177a591a4a896adfda97d22);
    }
}
