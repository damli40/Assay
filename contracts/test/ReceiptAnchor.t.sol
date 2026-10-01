// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {ReceiptAnchor} from "../src/ReceiptAnchor.sol";
import {IIdentityRegistry} from "../src/interfaces/IIdentityRegistry.sol";
import {MockIdentityRegistry} from "./mocks/MockIdentityRegistry.sol";

contract ReceiptAnchorTest is Test {
    uint256 internal constant HOST_PK = 0xA11CE;
    uint256 internal constant OTHER_PK = 0xB0B;
    uint256 internal constant REQUESTER_PK = 0xC0FFEE;
    uint256 internal constant N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    bytes1 internal constant UP = 0x01;
    bytes1 internal constant UV = 0x04;

    MockIdentityRegistry internal reg;
    ReceiptAnchor internal ra;
    address internal host = makeAddr("host");
    uint256 internal agentId;
    bytes32 internal qx;
    bytes32 internal qy;

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

    // OpenZeppelin MerkleProof node: keccak256 of the sorted pair.
    function _pairRoot(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

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

    function test_anchor_and_verifyReceipt() public {
        (bytes32 r, bytes32 s) = _sign(ra, HOST_PK, root, 2);

        vm.expectEmit(address(ra));
        emit ReceiptAnchor.Anchored(agentId, root, 2, ra.keyHashOf(qx, qy));
        vm.prank(makeAddr("relayer"));
        ra.anchor(agentId, root, 2, r, s);

        (uint32 count, uint64 at) = ra.anchors(agentId, root);
        assertEq(count, 2);
        assertEq(at, block.timestamp);

        assertTrue(ra.verifyReceipt(agentId, RECEIPT_A, _proof(ra.leafOf(RECEIPT_B)), root));
        assertTrue(ra.verifyReceipt(agentId, RECEIPT_B, _proof(ra.leafOf(RECEIPT_A)), root));
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

        (bytes32 r, bytes32 s) = _sign(ra, HOST_PK, root, 2);
        vm.expectRevert(ReceiptAnchor.BadHostSignature.selector);
        other.anchor(agentId, root, 2, r, s);

        (r, s) = _sign(other, HOST_PK, root, 2);
        other.anchor(agentId, root, 2, r, s);
    }

    function test_anchor_otherHostSameRoot_doesNotBlock() public {
        address mallory = makeAddr("mallory");
        vm.startPrank(mallory);
        uint256 malloryId = reg.register("");
        (uint256 x, uint256 y) = vm.publicKeyP256(OTHER_PK);
        ra.setHostKey(malloryId, bytes32(x), bytes32(y));
        vm.stopPrank();

        // Mallory copies the honest host's root from the mempool and anchors it first under her own id.
        (bytes32 mr, bytes32 ms) = vm.signP256(OTHER_PK, sha256(ra.anchorMessage(malloryId, root, 2)));
        ra.anchor(malloryId, root, 2, mr, ms);

        _anchor();
        assertTrue(ra.verifyReceipt(agentId, RECEIPT_A, _proof(ra.leafOf(RECEIPT_B)), root));
        (uint32 count,) = ra.anchors(agentId, root);
        assertEq(count, 2, "honest host's record is its own");
    }

    function test_verifyReceipt_otherHostsAnchor_false() public {
        _anchor();
        vm.prank(host);
        uint256 otherId = reg.register("");
        assertFalse(ra.verifyReceipt(otherId, RECEIPT_A, _proof(ra.leafOf(RECEIPT_B)), root));
    }

    function test_anchor_countTampered_reverts() public {
        (bytes32 r, bytes32 s) = _sign(ra, HOST_PK, root, 8);
        vm.expectRevert(ReceiptAnchor.BadHostSignature.selector);
        ra.anchor(agentId, root, 9, r, s);
    }

    function test_anchor_highS_reverts() public {
        (bytes32 r, bytes32 s) = _sign(ra, HOST_PK, root, 2);
        vm.expectRevert(ReceiptAnchor.BadHostSignature.selector);
        ra.anchor(agentId, root, 2, r, bytes32(N - uint256(s)));
    }

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

        assertTrue(ra.verifyReceipt(agentId, RECEIPT_A, _proof(ra.leafOf(RECEIPT_B)), root), "old anchor still valid");

        bytes32 newRoot = keccak256("next batch");
        (bytes32 r, bytes32 s) = _sign(ra, HOST_PK, newRoot, 1);
        vm.expectRevert(ReceiptAnchor.BadHostSignature.selector);
        ra.anchor(agentId, newRoot, 1, r, s);
    }

    function test_verifyReceipt_badProof_false() public {
        _anchor();
        bytes32 flipped = ra.leafOf(RECEIPT_B) ^ bytes32(uint256(1));
        assertFalse(ra.verifyReceipt(agentId, RECEIPT_A, _proof(flipped), root));
    }

    function test_verifyReceipt_unanchoredRoot_false() public view {
        assertFalse(ra.verifyReceipt(agentId, RECEIPT_A, _proof(ra.leafOf(RECEIPT_B)), root));
    }

    function test_verifyReceipt_wrongLeaf_false() public {
        _anchor();
        assertFalse(ra.verifyReceipt(agentId, keccak256("receipt c"), _proof(ra.leafOf(RECEIPT_B)), root));
    }

    function test_leafOf_knownVector() public view {
        // Root of a one-leaf StandardMerkleTree over 0x00..01, from @openzeppelin/merkle-tree 1.0.8.
        assertEq(ra.leafOf(bytes32(uint256(1))), 0xb5d9d894133a730aa651ef62d26b0ffa846233c74177a591a4a896adfda97d22);
    }

    // Same assertion layout as WebAuthn.t.sol: "type" at index 1, "challenge" at index 23.
    function _assertion(uint256 pk, bytes32 challenge, bytes1 flags)
        internal
        pure
        returns (WebAuthn.WebAuthnAuth memory)
    {
        string memory cdj = string.concat(
            '{"type":"webauthn.get","challenge":"',
            Base64.encodeURL(abi.encodePacked(challenge)),
            '","origin":"https://assay.example","crossOrigin":false}'
        );
        bytes memory authData = abi.encodePacked(sha256("assay.example"), flags, uint32(1));
        (bytes32 r, bytes32 s) = vm.signP256(pk, sha256(abi.encodePacked(authData, sha256(bytes(cdj)))));
        return WebAuthn.WebAuthnAuth({
            r: r, s: s, challengeIndex: 23, typeIndex: 1, authenticatorData: authData, clientDataJSON: cdj
        });
    }

    function _requesterKey(uint256 pk) internal view returns (bytes32 x, bytes32 y) {
        (uint256 ux, uint256 uy) = vm.publicKeyP256(pk);
        (x, y) = (bytes32(ux), bytes32(uy));
    }

    // Builds every argument first: vm.expectRevert applies to the next external call, which must be cosign.
    function _cosign(uint256 pk, WebAuthn.WebAuthnAuth memory auth, bytes4 expectedError) internal {
        (bytes32 x, bytes32 y) = _requesterKey(pk);
        bytes32[] memory proof = _proof(ra.leafOf(RECEIPT_B));
        if (expectedError != bytes4(0)) vm.expectRevert(expectedError);
        ra.cosign(agentId, RECEIPT_A, proof, root, auth, x, y);
    }

    function test_cosign_valid() public {
        _anchor();
        (bytes32 x, bytes32 y) = _requesterKey(REQUESTER_PK);
        vm.expectEmit(address(ra));
        emit ReceiptAnchor.Cosigned(RECEIPT_A, ra.keyHashOf(x, y), agentId, root);
        _cosign(REQUESTER_PK, _assertion(REQUESTER_PK, RECEIPT_A, UP | UV), bytes4(0));
        assertTrue(ra.cosigned(RECEIPT_A, ra.keyHashOf(x, y)));
    }

    function test_cosign_replay_reverts() public {
        _anchor();
        WebAuthn.WebAuthnAuth memory auth = _assertion(REQUESTER_PK, RECEIPT_A, UP | UV);
        _cosign(REQUESTER_PK, auth, bytes4(0));
        _cosign(REQUESTER_PK, auth, ReceiptAnchor.AlreadyCosigned.selector);
    }

    function test_cosign_otherKeyFirst_doesNotBlock() public {
        _anchor();
        // An attacker who saw the receipt hash co-signs first with their own passkey.
        _cosign(OTHER_PK, _assertion(OTHER_PK, RECEIPT_A, UP | UV), bytes4(0));
        _cosign(REQUESTER_PK, _assertion(REQUESTER_PK, RECEIPT_A, UP | UV), bytes4(0));
        (bytes32 x, bytes32 y) = _requesterKey(REQUESTER_PK);
        assertTrue(ra.cosigned(RECEIPT_A, ra.keyHashOf(x, y)));
    }

    function test_cosign_notAnchored_reverts() public {
        WebAuthn.WebAuthnAuth memory auth = _assertion(REQUESTER_PK, RECEIPT_A, UP | UV);
        _cosign(REQUESTER_PK, auth, ReceiptAnchor.ReceiptNotAnchored.selector);
    }

    function test_cosign_badProof_reverts() public {
        _anchor();
        WebAuthn.WebAuthnAuth memory auth = _assertion(REQUESTER_PK, RECEIPT_A, UP | UV);
        (bytes32 x, bytes32 y) = _requesterKey(REQUESTER_PK);
        bytes32[] memory bad = _proof(ra.leafOf(RECEIPT_B) ^ bytes32(uint256(1)));
        vm.expectRevert(ReceiptAnchor.ReceiptNotAnchored.selector);
        ra.cosign(agentId, RECEIPT_A, bad, root, auth, x, y);
    }

    function test_cosign_otherHostsAgentId_reverts() public {
        _anchor();
        vm.prank(host);
        uint256 otherId = reg.register("");
        WebAuthn.WebAuthnAuth memory auth = _assertion(REQUESTER_PK, RECEIPT_A, UP | UV);
        (bytes32 x, bytes32 y) = _requesterKey(REQUESTER_PK);
        bytes32[] memory proof = _proof(ra.leafOf(RECEIPT_B));
        vm.expectRevert(ReceiptAnchor.ReceiptNotAnchored.selector);
        ra.cosign(otherId, RECEIPT_A, proof, root, auth, x, y);
    }

    function test_cosign_challengeIsOtherReceipt_reverts() public {
        _anchor();
        WebAuthn.WebAuthnAuth memory auth = _assertion(REQUESTER_PK, RECEIPT_B, UP | UV);
        _cosign(REQUESTER_PK, auth, ReceiptAnchor.BadCosignature.selector);
    }

    function test_cosign_missingUP_reverts() public {
        _anchor();
        WebAuthn.WebAuthnAuth memory auth = _assertion(REQUESTER_PK, RECEIPT_A, UV);
        _cosign(REQUESTER_PK, auth, ReceiptAnchor.BadCosignature.selector);
    }

    function test_cosign_missingUV_reverts() public {
        _anchor();
        WebAuthn.WebAuthnAuth memory auth = _assertion(REQUESTER_PK, RECEIPT_A, UP);
        _cosign(REQUESTER_PK, auth, ReceiptAnchor.BadCosignature.selector);
    }

    function test_cosign_wrongKey_reverts() public {
        _anchor();
        // Signed by OTHER_PK, presented as REQUESTER_PK's key.
        WebAuthn.WebAuthnAuth memory auth = _assertion(OTHER_PK, RECEIPT_A, UP | UV);
        _cosign(REQUESTER_PK, auth, ReceiptAnchor.BadCosignature.selector);
    }

    function test_cosign_highS_reverts() public {
        _anchor();
        WebAuthn.WebAuthnAuth memory auth = _assertion(REQUESTER_PK, RECEIPT_A, UP | UV);
        auth.s = bytes32(N - uint256(auth.s));
        _cosign(REQUESTER_PK, auth, ReceiptAnchor.BadCosignature.selector);
    }
}
