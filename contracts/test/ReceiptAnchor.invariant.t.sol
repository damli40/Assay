// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ReceiptAnchor} from "../src/ReceiptAnchor.sol";
import {IIdentityRegistry} from "../src/interfaces/IIdentityRegistry.sol";
import {MockIdentityRegistry} from "./mocks/MockIdentityRegistry.sol";

/// Drives ReceiptAnchor with random anchors from two hosts, forged signatures and replays, and keeps a ghost copy
/// of what should be onchain.
contract AnchorHandler is Test {
    ReceiptAnchor internal ra;
    uint256[2] public agents;
    uint256[2] internal keys = [uint256(0xA11CE), uint256(0xB0B)];

    struct Ghost {
        uint32 count;
        uint64 at;
    }

    mapping(uint256 agent => mapping(bytes32 root => Ghost)) public ghost;
    bytes32[] public receipts;
    uint256[] public owners;
    bool public forgedAccepted;
    bool public replayAccepted;

    constructor(ReceiptAnchor ra_, uint256 a, uint256 b) {
        ra = ra_;
        agents = [a, b];
    }

    function _sig(uint256 key, uint256 agent, bytes32 root, uint32 count) internal view returns (bytes32, bytes32) {
        return vm.signP256(key, sha256(ra.anchorMessage(agent, root, count)));
    }

    function receiptCount() external view returns (uint256) {
        return receipts.length;
    }

    /// A host anchors a fresh single-receipt batch (root = leaf, empty proof).
    function anchor(uint8 who, uint256 seed, uint32 count) external {
        who %= 2;
        count = uint32(bound(count, 1, 1000));
        bytes32 receipt = keccak256(abi.encode("receipt", seed));
        bytes32 root = ra.leafOf(receipt);
        if (ghost[agents[who]][root].at != 0) return;
        (bytes32 r, bytes32 s) = _sig(keys[who], agents[who], root, count);
        vm.warp(block.timestamp + 1);
        ra.anchor(agents[who], root, count, r, s);
        ghost[agents[who]][root] = Ghost(count, uint64(block.timestamp));
        receipts.push(receipt);
        owners.push(who);
    }

    /// The other host's key, or a wrong count, must never anchor under this host.
    function forge(uint8 who, uint256 seed, uint32 count) external {
        who %= 2;
        count = uint32(bound(count, 1, 1000));
        bytes32 root = ra.leafOf(keccak256(abi.encode("forged", seed)));
        (bytes32 r, bytes32 s) = _sig(keys[1 - who], agents[who], root, count);
        try ra.anchor(agents[who], root, count, r, s) {
            forgedAccepted = true;
        } catch {}
        (r, s) = _sig(keys[who], agents[who], root, count);
        try ra.anchor(agents[who], root, count + 1, r, s) {
            forgedAccepted = true;
        } catch {}
    }

    /// Re-submitting an anchored batch must always revert.
    function replay(uint256 i) external {
        if (receipts.length == 0) return;
        i = bound(i, 0, receipts.length - 1);
        uint256 agent = agents[owners[i]];
        bytes32 root = ra.leafOf(receipts[i]);
        uint32 count = ghost[agent][root].count;
        (bytes32 r, bytes32 s) = _sig(keys[owners[i]], agent, root, count);
        try ra.anchor(agent, root, count, r, s) {
            replayAccepted = true;
        } catch {}
    }

    function owner(uint256 i) external view returns (uint256) {
        return owners[i];
    }
}

/// Each invariant re-checks every anchored receipt after every call, so the cost grows with depth squared.
/// forge-config: default.invariant.runs = 64
/// forge-config: default.invariant.depth = 50
contract ReceiptAnchorInvariantTest is Test {
    ReceiptAnchor internal ra;
    AnchorHandler internal handler;
    uint256 internal a;
    uint256 internal b;

    function setUp() public {
        MockIdentityRegistry reg = new MockIdentityRegistry();
        ra = new ReceiptAnchor(IIdentityRegistry(address(reg)), true);
        a = reg.register("");
        b = reg.register("");
        (uint256 ax, uint256 ay) = vm.publicKeyP256(0xA11CE);
        (uint256 bx, uint256 by) = vm.publicKeyP256(0xB0B);
        ra.setHostKey(a, bytes32(ax), bytes32(ay));
        ra.setHostKey(b, bytes32(bx), bytes32(by));
        handler = new AnchorHandler(ra, a, b);
        targetContract(address(handler));
    }

    function invariant_noForgedOrReplayedAnchor() public view {
        assertFalse(handler.forgedAccepted(), "an anchor without the host's own signature was accepted");
        assertFalse(handler.replayAccepted(), "an anchored batch was accepted twice");
    }

    /// What's onchain is exactly what each host signed, and anchoredAt never moves once set.
    function invariant_anchorsMatchWhatHostsSigned() public view {
        uint256[2] memory agents = [a, b];
        for (uint256 i; i < handler.receiptCount(); i++) {
            uint256 agent = agents[handler.owner(i)];
            bytes32 root = ra.leafOf(handler.receipts(i));
            (uint32 count, uint64 at) = ra.anchors(agent, root);
            (uint32 gCount, uint64 gAt) = handler.ghost(agent, root);
            assertEq(count, gCount);
            assertEq(at, gAt);
        }
    }

    /// A receipt verifies under a host exactly when that host anchored its root: another host's anchor never counts.
    function invariant_receiptVerifiesOnlyUnderItsHost() public view {
        uint256[2] memory agents = [a, b];
        bytes32[] memory noProof = new bytes32[](0);
        for (uint256 i; i < handler.receiptCount(); i++) {
            bytes32 receipt = handler.receipts(i);
            bytes32 root = ra.leafOf(receipt);
            for (uint256 h; h < 2; h++) {
                (, uint64 at) = handler.ghost(agents[h], root);
                assertEq(ra.verifyReceipt(agents[h], receipt, noProof, root), at != 0);
            }
        }
    }
}
