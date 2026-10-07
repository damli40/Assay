// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {AssayAccount} from "../src/AssayAccount.sol";

/// Stands in for the ERC-8004 ReputationRegistry: what matters is who `msg.sender` is.
contract FeedbackSink {
    address public lastSender;
    uint256 public lastAgent;

    function giveFeedback(uint256 agentId, int128, uint8, string calldata, string calldata, string calldata, string calldata, bytes32)
        external
    {
        lastSender = msg.sender;
        lastAgent = agentId;
    }

    function boom() external pure {
        revert("no");
    }
}

contract AssayAccountTest is Test {
    AssayAccount impl;
    FeedbackSink sink;
    uint256 constant KEY = 0xA11CE;
    address account;
    address relayer = makeAddr("relayer");

    function setUp() public {
        impl = new AssayAccount();
        sink = new FeedbackSink();
        account = vm.addr(KEY);
        vm.signAndAttachDelegation(address(impl), KEY);
        vm.deal(relayer, 1 ether);
    }

    function _feedback() internal pure returns (bytes memory) {
        return abi.encodeCall(FeedbackSink.giveFeedback, (10278, -1, 0, "assay", "receipt", "", "", bytes32(uint256(1))));
    }

    function _digest(address acct, uint256 chainId, address target, bytes memory data, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes32)
    {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("AssayAccount"),
                keccak256("1"),
                chainId,
                acct
            )
        );
        bytes32 structHash = keccak256(abi.encode(impl.CALL_TYPEHASH(), target, keccak256(data), nonce, deadline));
        return MessageHashUtils.toTypedDataHash(domain, structHash);
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signed(bytes memory data, uint256 nonce, uint256 deadline) internal view returns (bytes memory) {
        return _sign(KEY, _digest(account, block.chainid, address(sink), data, nonce, deadline));
    }

    function test_execute_relayerPays_targetSeesAccount() public {
        bytes memory data = _feedback();
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _signed(data, 7, deadline);

        vm.prank(relayer);
        AssayAccount(account).execute(address(sink), data, 7, deadline, sig);

        assertEq(sink.lastSender(), account, "the registry sees the per-app address as the sender");
        assertEq(sink.lastAgent(), 10278);
        assertEq(account.balance, 0, "the per-app address never held MON");
        assertTrue(AssayAccount(account).nonceUsed(7));
    }

    function test_execute_replay_reverts() public {
        bytes memory data = _feedback();
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _signed(data, 1, deadline);
        AssayAccount(account).execute(address(sink), data, 1, deadline, sig);
        vm.expectRevert(AssayAccount.NonceUsed.selector);
        AssayAccount(account).execute(address(sink), data, 1, deadline, sig);
    }

    function test_execute_unorderedNonces() public {
        bytes memory data = _feedback();
        uint256 deadline = block.timestamp + 600;
        AssayAccount(account).execute(address(sink), data, 9, deadline, _signed(data, 9, deadline));
        AssayAccount(account).execute(address(sink), data, 2, deadline, _signed(data, 2, deadline));
        assertTrue(AssayAccount(account).nonceUsed(2) && AssayAccount(account).nonceUsed(9));
    }

    function test_execute_expired_reverts() public {
        bytes memory data = _feedback();
        uint256 deadline = block.timestamp + 60;
        bytes memory sig = _signed(data, 1, deadline);
        vm.warp(deadline + 1);
        vm.expectRevert(AssayAccount.Expired.selector);
        AssayAccount(account).execute(address(sink), data, 1, deadline, sig);
    }

    function test_execute_otherKey_reverts() public {
        bytes memory data = _feedback();
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _sign(0xB0B, _digest(account, block.chainid, address(sink), data, 1, deadline));
        vm.expectRevert(AssayAccount.BadSigner.selector);
        AssayAccount(account).execute(address(sink), data, 1, deadline, sig);
    }

    function test_execute_tamperedCall_reverts() public {
        bytes memory data = _feedback();
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _signed(data, 1, deadline);
        bytes memory other = abi.encodeCall(FeedbackSink.giveFeedback, (1962, -1, 0, "assay", "receipt", "", "", bytes32(uint256(1))));

        vm.expectRevert(AssayAccount.BadSigner.selector);
        AssayAccount(account).execute(address(sink), other, 1, deadline, sig);
        vm.expectRevert(AssayAccount.BadSigner.selector);
        AssayAccount(account).execute(makeAddr("elsewhere"), data, 1, deadline, sig);
        vm.expectRevert(AssayAccount.BadSigner.selector);
        AssayAccount(account).execute(address(sink), data, 2, deadline, sig);
    }

    function test_execute_otherChainSignature_reverts() public {
        bytes memory data = _feedback();
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _sign(KEY, _digest(account, block.chainid + 1, address(sink), data, 1, deadline));
        vm.expectRevert(AssayAccount.BadSigner.selector);
        AssayAccount(account).execute(address(sink), data, 1, deadline, sig);
    }

    function test_execute_signatureForAnotherAccount_reverts() public {
        // Same key, but the domain names another account: it can't be replayed here.
        bytes memory data = _feedback();
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _sign(KEY, _digest(makeAddr("other"), block.chainid, address(sink), data, 1, deadline));
        vm.expectRevert(AssayAccount.BadSigner.selector);
        AssayAccount(account).execute(address(sink), data, 1, deadline, sig);
    }

    function test_execute_onImplementation_reverts() public {
        // Nobody holds a key for the implementation's address.
        bytes memory data = _feedback();
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _sign(KEY, _digest(address(impl), block.chainid, address(sink), data, 1, deadline));
        vm.expectRevert(AssayAccount.BadSigner.selector);
        impl.execute(address(sink), data, 1, deadline, sig);
    }

    function test_execute_targetReverts_bubbles_andNonceStaysFree() public {
        bytes memory data = abi.encodeCall(FeedbackSink.boom, ());
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _signed(data, 1, deadline);
        vm.expectRevert(abi.encodeWithSelector(AssayAccount.CallFailed.selector, abi.encodeWithSignature("Error(string)", "no")));
        AssayAccount(account).execute(address(sink), data, 1, deadline, sig);
        assertFalse(AssayAccount(account).nonceUsed(1));
    }

    function test_execute_highS_reverts() public {
        bytes memory data = _feedback();
        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(KEY, _digest(account, block.chainid, address(sink), data, 1, deadline));
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes memory malleable = abi.encodePacked(r, bytes32(n - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert();
        AssayAccount(account).execute(address(sink), data, 1, deadline, malleable);
    }

    function testFuzz_execute_onlyOwnKeyWorks(uint256 otherKey) public {
        otherKey = bound(otherKey, 1, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364140);
        vm.assume(otherKey != KEY);
        bytes memory data = _feedback();
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _sign(otherKey, _digest(account, block.chainid, address(sink), data, 1, deadline));
        vm.expectRevert(AssayAccount.BadSigner.selector);
        AssayAccount(account).execute(address(sink), data, 1, deadline, sig);
    }
}
