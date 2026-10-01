// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";
import {ReceiptAnchor} from "../src/ReceiptAnchor.sol";
import {IIdentityRegistry} from "../src/interfaces/IIdentityRegistry.sol";
import {MockIdentityRegistry} from "./mocks/MockIdentityRegistry.sol";

// Checks the output of sdk/scripts/gen-vectors.mjs against the contracts.
contract FixturesTest is Test {
    // Must match CHAIN_ID and ANCHOR_ADDRESS in gen-vectors.mjs.
    uint256 internal constant CHAIN_ID = 31337;
    address internal constant ANCHOR_ADDRESS = address(uint160(0xA55A7000));
    uint256 internal constant SIGNATURE_COUNT = 10;
    uint256 internal constant LEAF_COUNT = 8;

    string internal json;
    ReceiptAnchor internal ra;
    bytes32 internal qx;
    bytes32 internal qy;
    bytes32 internal root;

    function setUp() public {
        json = vm.readFile("test/fixtures/webcrypto.json");
        qx = vm.parseJsonBytes32(json, ".key.x");
        qy = vm.parseJsonBytes32(json, ".key.y");
        root = vm.parseJsonBytes32(json, ".merkle.root");

        vm.chainId(CHAIN_ID);
        MockIdentityRegistry reg = new MockIdentityRegistry();
        // The Node anchor signature commits to this address.
        deployCodeTo(
            "ReceiptAnchor.sol:ReceiptAnchor", abi.encode(IIdentityRegistry(address(reg)), true), ANCHOR_ADDRESS
        );
        ra = ReceiptAnchor(ANCHOR_ADDRESS);

        uint256 agentId = reg.register("");
        assertEq(agentId, vm.parseJsonUint(json, ".anchor.agentId"));
        ra.setHostKey(agentId, qx, qy);
    }

    function _at(string memory prefix, uint256 i, string memory suffix) internal pure returns (string memory) {
        return string.concat(prefix, "[", vm.toString(i), "]", suffix);
    }

    function _proof(uint256 i) internal view returns (bytes32[] memory) {
        return vm.parseJsonBytes32Array(json, _at(".merkle.proofs", i, ""));
    }

    function _anchorFromNode() internal {
        ra.anchor(
            vm.parseJsonUint(json, ".anchor.agentId"),
            root,
            uint32(vm.parseJsonUint(json, ".anchor.count")),
            vm.parseJsonBytes32(json, ".anchor.r"),
            vm.parseJsonBytes32(json, ".anchor.s")
        );
    }

    function test_webcryptoSignatures_verifyOnPrecompile() public view {
        for (uint256 i; i < SIGNATURE_COUNT; i++) {
            bytes32 digest = vm.parseJsonBytes32(json, _at(".signatures", i, ".digest"));
            bytes32 r = vm.parseJsonBytes32(json, _at(".signatures", i, ".r"));
            bytes32 s = vm.parseJsonBytes32(json, _at(".signatures", i, ".s"));
            assertEq(
                digest, sha256(vm.parseJsonBytes(json, _at(".signatures", i, ".message"))), "digest is sha256(message)"
            );
            assertTrue(P256.verifyNative(digest, r, s, qx, qy), "WebCrypto signature (low-s normalized)");
        }
    }

    function test_anchorMessage_matchesNode() public view {
        assertEq(
            ra.anchorMessage(
                vm.parseJsonUint(json, ".anchor.agentId"), root, uint32(vm.parseJsonUint(json, ".anchor.count"))
            ),
            vm.parseJsonBytes(json, ".anchor.message")
        );
    }

    function test_nodeAnchorSignature_accepted() public {
        _anchorFromNode();
        (, uint32 count, uint64 at) = ra.anchors(root);
        assertEq(count, LEAF_COUNT);
        assertGt(at, 0);
    }

    function test_leafOf_matchesStandardMerkleTree() public view {
        for (uint256 i; i < LEAF_COUNT; i++) {
            bytes32 receipt = vm.parseJsonBytes32(json, _at(".merkle.receipts", i, ""));
            assertEq(ra.leafOf(receipt), vm.parseJsonBytes32(json, _at(".merkle.leaves", i, "")));
        }
    }

    function test_nodeProofs_verifyReceipt() public {
        _anchorFromNode();
        for (uint256 i; i < LEAF_COUNT; i++) {
            bytes32 receipt = vm.parseJsonBytes32(json, _at(".merkle.receipts", i, ""));
            assertTrue(ra.verifyReceipt(receipt, _proof(i), root));
        }
    }

    function testFuzz_mutatedProofFails(uint8 leafIdx, uint8 proofIdx, uint8 bit) public {
        _anchorFromNode();
        uint256 i = leafIdx % LEAF_COUNT;
        bytes32 receipt = vm.parseJsonBytes32(json, _at(".merkle.receipts", i, ""));
        bytes32[] memory proof = _proof(i);

        proof[proofIdx % proof.length] ^= bytes32(uint256(1) << bit);
        assertFalse(ra.verifyReceipt(receipt, proof, root));
    }
}
