// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {CreAttestor} from "../src/CreAttestor.sol";

contract CreAttestorTest is Test {
    CreAttestor internal att;
    address internal owner = makeAddr("owner");
    address internal fwd = makeAddr("forwarder");
    address internal verifier = makeAddr("verifier");
    bytes32 internal constant MODEL = keccak256("z-ai/glm-5.3");
    bytes32 internal constant HOST_KEY = keccak256("host");
    uint64 internal constant T = 1_790_000_000;

    function setUp() public {
        att = new CreAttestor(owner);
        vm.prank(owner);
        att.setForwarder(fwd);
    }

    function _report(uint32 passed, uint32 total, uint16 lo, uint16 hi) internal view returns (bytes memory) {
        return abi.encode(verifier, MODEL, HOST_KEY, T, passed, total, lo, hi, true);
    }

    function _onReport(bytes memory report, bytes4 expectedError) internal {
        if (expectedError != bytes4(0)) vm.expectRevert(expectedError);
        vm.prank(fwd);
        att.onReport("", report);
    }

    function test_onReport_storesAndEmits() public {
        vm.expectEmit(address(att));
        emit CreAttestor.GradeAttested(verifier, MODEL, HOST_KEY, T, true, 47, 50);
        _onReport(_report(47, 50, 8_400, 9_800), bytes4(0));

        (uint32 passed, uint32 total, uint16 lo, uint16 hi, bool agree) = att.attestations(verifier, MODEL, HOST_KEY, T);
        assertEq(passed, 47);
        assertEq(total, 50);
        assertEq(lo, 8_400);
        assertEq(hi, 9_800);
        assertTrue(agree);
    }

    function test_onReport_overwritesSameKey() public {
        _onReport(_report(47, 50, 8_400, 9_800), bytes4(0));
        _onReport(_report(10, 50, 1_000, 3_000), bytes4(0));
        (uint32 passed,,,,) = att.attestations(verifier, MODEL, HOST_KEY, T);
        assertEq(passed, 10);
    }

    function test_onReport_nonForwarder_reverts() public {
        bytes memory report = _report(47, 50, 8_400, 9_800);
        vm.expectRevert(CreAttestor.NotForwarder.selector);
        vm.prank(owner);
        att.onReport("", report);
    }

    function test_onReport_forwarderUnset_reverts() public {
        CreAttestor fresh = new CreAttestor(owner);
        bytes memory report = _report(47, 50, 8_400, 9_800);
        vm.expectRevert(CreAttestor.NotForwarder.selector);
        fresh.onReport("", report);
    }

    function test_setForwarder_twice_reverts() public {
        vm.expectRevert(CreAttestor.ForwarderAlreadySet.selector);
        vm.prank(owner);
        att.setForwarder(makeAddr("other"));
    }

    function test_setForwarder_nonOwner_reverts() public {
        CreAttestor fresh = new CreAttestor(owner);
        vm.expectRevert(CreAttestor.NotOwner.selector);
        fresh.setForwarder(fwd);
    }

    function test_onReport_wrongLength_reverts() public {
        bytes memory report = _report(47, 50, 8_400, 9_800);
        _onReport(abi.encodePacked(report, uint8(0)), CreAttestor.BadReport.selector);
        _onReport(abi.encode(verifier, MODEL), CreAttestor.BadReport.selector);
        _onReport("", CreAttestor.BadReport.selector);
    }

    function test_onReport_dirtyBool_reverts() public {
        bytes memory report = _report(47, 50, 8_400, 9_800);
        report[report.length - 1] = 0x02;
        vm.prank(fwd);
        vm.expectRevert();
        att.onReport("", report);
    }

    function test_onReport_zeroTotal_reverts() public {
        _onReport(_report(0, 0, 0, 0), CreAttestor.BadReport.selector);
    }

    function test_onReport_passedAboveTotal_reverts() public {
        _onReport(_report(51, 50, 8_400, 9_800), CreAttestor.BadReport.selector);
    }

    function test_onReport_ciInverted_reverts() public {
        _onReport(_report(47, 50, 9_800, 8_400), CreAttestor.BadReport.selector);
    }

    function test_onReport_ciAbove100Percent_reverts() public {
        _onReport(_report(50, 50, 9_000, 10_001), CreAttestor.BadReport.selector);
    }

    function test_onReport_boundaries_ok() public {
        _onReport(_report(50, 50, 10_000, 10_000), bytes4(0));
        _onReport(_report(0, 1, 0, 0), bytes4(0));
    }

    function test_supportsInterface() public view {
        assertTrue(att.supportsInterface(type(IERC165).interfaceId));
        assertTrue(att.supportsInterface(bytes4(keccak256("onReport(bytes,bytes)"))));
        assertFalse(att.supportsInterface(0xffffffff));
    }
}
