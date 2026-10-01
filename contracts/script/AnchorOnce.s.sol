// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ReceiptAnchor} from "../src/ReceiptAnchor.sol";

/// Anchors a two-receipt demo batch with a throwaway P-256 key, registering that key first if needed.
/// The real host key replaces it on Day 5.
/// ANCHOR_ADDRESS=... HOST_AGENT_ID=... DEMO_HOST_P256_PK=... \
/// forge script script/AnchorOnce.s.sol --rpc-url monad_testnet --account assay-host --sender <assay-host address> --broadcast
contract AnchorOnce is Script {
    struct Batch {
        bytes32 receiptA;
        bytes32 receiptB;
        bytes32 leafA;
        bytes32 leafB;
        bytes32 root;
    }

    function run() external {
        ReceiptAnchor ra = ReceiptAnchor(vm.envAddress("ANCHOR_ADDRESS"));
        uint256 agentId = vm.envUint("HOST_AGENT_ID");
        uint256 pk = vm.envUint("DEMO_HOST_P256_PK");

        Batch memory b = _demoBatch(ra);
        (bytes32 r, bytes32 s) = vm.signP256(pk, sha256(ra.anchorMessage(agentId, b.root, 2)));

        vm.startBroadcast();
        _ensureHostKey(ra, agentId, pk);
        ra.anchor(agentId, b.root, 2, r, s);
        vm.stopBroadcast();

        bytes32[] memory proofA = new bytes32[](1);
        proofA[0] = b.leafB;
        require(ra.verifyReceipt(agentId, b.receiptA, proofA, b.root), "receipt A does not verify");

        console.log("agentId", agentId);
        console.log("root");
        console.logBytes32(b.root);
        console.log("receipt A, proof = [leafOf(B)]");
        console.logBytes32(b.receiptA);
        console.log("receipt B, proof = [leafOf(A)]");
        console.logBytes32(b.receiptB);
    }

    function _demoBatch(ReceiptAnchor ra) internal view returns (Batch memory b) {
        b.receiptA = keccak256(abi.encode("assay demo receipt", block.timestamp, uint256(1)));
        b.receiptB = keccak256(abi.encode("assay demo receipt", block.timestamp, uint256(2)));
        b.leafA = ra.leafOf(b.receiptA);
        b.leafB = ra.leafOf(b.receiptB);
        b.root = b.leafA < b.leafB ? keccak256(abi.encode(b.leafA, b.leafB)) : keccak256(abi.encode(b.leafB, b.leafA));
    }

    function _ensureHostKey(ReceiptAnchor ra, uint256 agentId, uint256 pk) internal {
        (uint256 x, uint256 y) = vm.publicKeyP256(pk);
        (bytes32 qx, bytes32 qy) = ra.hostKeys(agentId);
        if (qx != bytes32(x) || qy != bytes32(y)) ra.setHostKey(agentId, bytes32(x), bytes32(y));
    }
}
