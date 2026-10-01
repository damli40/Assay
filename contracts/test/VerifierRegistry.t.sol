// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {VerifierRegistry} from "../src/VerifierRegistry.sol";
import {IIdentityRegistry} from "../src/interfaces/IIdentityRegistry.sol";
import {MockIdentityRegistry} from "./mocks/MockIdentityRegistry.sol";

contract VerifierRegistryTest is Test {
    MockIdentityRegistry internal reg;
    VerifierRegistry internal vr;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    uint256 internal aliceId;
    uint256 internal bobId;

    bytes32 internal constant MODEL = keccak256("z-ai/glm-5.3");
    bytes32 internal constant HOST = keccak256("openrouter:z-ai/fp8");

    function setUp() public {
        vm.warp(1_790_000_000);
        reg = new MockIdentityRegistry();
        vr = new VerifierRegistry(IIdentityRegistry(address(reg)));

        vm.startPrank(alice);
        aliceId = reg.register("");
        vr.registerVerifier(aliceId);
        vm.stopPrank();

        vm.startPrank(bob);
        bobId = reg.register("");
        vr.registerVerifier(bobId);
        vm.stopPrank();
    }

    function _grade(uint32 passed, uint32 total, uint64 t) internal pure returns (VerifierRegistry.Grade memory) {
        return VerifierRegistry.Grade({
            model: MODEL,
            hostKey: HOST,
            checks: keccak256("assay-checks/tool-calls-v0"),
            passed: passed,
            total: total,
            ciLowBps: 8000,
            ciHighBps: 9500,
            refModel: keccak256("z-ai"),
            evidence: sha256("evidence bundle"),
            t: t
        });
    }

    function _post(address who, VerifierRegistry.Grade memory g) internal {
        vm.prank(who);
        vr.postGrade(g);
    }

    function _postExpect(address who, VerifierRegistry.Grade memory g, bytes4 err) internal {
        vm.prank(who);
        vm.expectRevert(err);
        vr.postGrade(g);
    }

    function _trusted(address a) internal pure returns (address[] memory t) {
        t = new address[](1);
        t[0] = a;
    }

    function _trusted(address a, address b) internal pure returns (address[] memory t) {
        t = new address[](2);
        (t[0], t[1]) = (a, b);
    }

    function test_register_nonOwner_reverts() public {
        vm.prank(bob);
        vm.expectRevert(VerifierRegistry.NotAgentOwner.selector);
        vr.registerVerifier(aliceId);
    }

    function test_post_valid_storesAndEmits() public {
        VerifierRegistry.Grade memory g = _grade(9, 10, uint64(block.timestamp));
        vm.expectEmit(address(vr));
        emit VerifierRegistry.GradePosted(
            alice, aliceId, MODEL, HOST, 9, 10, 8000, 9500, g.checks, g.refModel, g.evidence, g.t
        );
        _post(alice, g);
        assertEq(abi.encode(vr.latestGrade(alice, MODEL, HOST)), abi.encode(g));
    }

    function test_post_unregistered_reverts() public {
        _postExpect(makeAddr("stranger"), _grade(9, 10, uint64(block.timestamp)), VerifierRegistry.NotVerifier.selector);
    }

    function test_post_afterIdentityTransferred_reverts() public {
        vm.prank(alice);
        reg.transfer(aliceId, makeAddr("buyer"));
        _postExpect(alice, _grade(9, 10, uint64(block.timestamp)), VerifierRegistry.NotVerifier.selector);
    }

    function test_post_passedGtTotal_reverts() public {
        _postExpect(alice, _grade(11, 10, uint64(block.timestamp)), VerifierRegistry.BadCounts.selector);
    }

    function test_post_totalZero_reverts() public {
        _postExpect(alice, _grade(0, 0, uint64(block.timestamp)), VerifierRegistry.BadCounts.selector);
    }

    function test_post_ciInverted_reverts() public {
        VerifierRegistry.Grade memory g = _grade(9, 10, uint64(block.timestamp));
        (g.ciLowBps, g.ciHighBps) = (9500, 8000);
        _postExpect(alice, g, VerifierRegistry.BadInterval.selector);
    }

    function test_post_ciOver10000_reverts() public {
        VerifierRegistry.Grade memory g = _grade(9, 10, uint64(block.timestamp));
        g.ciHighBps = 10_001;
        _postExpect(alice, g, VerifierRegistry.BadInterval.selector);
    }

    function test_post_futureTimestamp_reverts() public {
        _postExpect(alice, _grade(9, 10, uint64(block.timestamp + 1)), VerifierRegistry.FutureTimestamp.selector);
    }

    function test_post_staleGrade_reverts() public {
        _post(alice, _grade(9, 10, uint64(block.timestamp)));
        _postExpect(alice, _grade(5, 10, uint64(block.timestamp - 1)), VerifierRegistry.StaleGrade.selector);
        _postExpect(alice, _grade(5, 10, uint64(block.timestamp)), VerifierRegistry.StaleGrade.selector);
    }

    function test_gradeOf_ignoresUntrusted() public {
        _post(alice, _grade(9, 10, uint64(block.timestamp - 10)));
        _post(bob, _grade(1, 10, uint64(block.timestamp)));

        (VerifierRegistry.Grade memory g, address by) = vr.gradeOf(MODEL, HOST, _trusted(alice));
        assertEq(by, alice);
        assertEq(g.passed, 9);
    }

    function test_gradeOf_newestTrustedWins() public {
        _post(alice, _grade(9, 10, uint64(block.timestamp - 10)));
        _post(bob, _grade(1, 10, uint64(block.timestamp)));

        (VerifierRegistry.Grade memory g, address by) = vr.gradeOf(MODEL, HOST, _trusted(alice, bob));
        assertEq(by, bob);
        assertEq(g.passed, 1);
    }

    function test_gradeOf_tieFirstListedWins() public {
        _post(alice, _grade(9, 10, uint64(block.timestamp)));
        _post(bob, _grade(1, 10, uint64(block.timestamp)));

        (, address by) = vr.gradeOf(MODEL, HOST, _trusted(bob, alice));
        assertEq(by, bob);
    }

    function test_gradeOf_emptyTrusted_returnsZero() public {
        _post(alice, _grade(9, 10, uint64(block.timestamp)));
        (VerifierRegistry.Grade memory g, address by) = vr.gradeOf(MODEL, HOST, new address[](0));
        assertEq(by, address(0));
        assertEq(g.t, 0);
    }

    function test_gradeOf_otherHostKeyIsSeparate() public {
        _post(alice, _grade(9, 10, uint64(block.timestamp)));
        (, address by) = vr.gradeOf(MODEL, keccak256("openrouter:other"), _trusted(alice));
        assertEq(by, address(0));
    }
}
