// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {AssayAccount} from "../../src/AssayAccount.sol";

interface IReputationRegistry {
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;
}

/// A per-app key with no MON files ERC-8004 feedback on the real ReputationRegistry, through EIP-7702 and a relayer:
/// forge test --match-path "test/fork/*" --fork-url monad_testnet -vv
contract SponsoredFeedbackForkTest is Test {
    IReputationRegistry internal constant REPUTATION = IReputationRegistry(0x8004B663056A597Dffe9eCcC1965A193B7388713);
    uint256 internal constant APP_KEY = 0xA99;
    uint256 internal constant HOST_AGENT = 1962;

    function setUp() public {
        if (address(REPUTATION).code.length == 0) vm.skip(true);
    }

    function test_fork_unfundedPerAppKey_givesFeedback_viaRelayer() public {
        AssayAccount impl = new AssayAccount();
        address app = vm.addr(APP_KEY);
        assertEq(app.balance, 0);
        vm.signAndAttachDelegation(address(impl), APP_KEY);

        bytes32 receiptHash = keccak256("receipt the complaint cites");
        bytes memory data = abi.encodeCall(
            IReputationRegistry.giveFeedback, (HOST_AGENT, -100, 0, "assay", "receipt", "", "", receiptHash)
        );
        uint256 deadline = block.timestamp + 600;
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("AssayAccount"),
                keccak256("1"),
                block.chainid,
                app
            )
        );
        bytes32 digest = MessageHashUtils.toTypedDataHash(
            domain, keccak256(abi.encode(impl.CALL_TYPEHASH(), address(REPUTATION), keccak256(data), 1, deadline))
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(APP_KEY, digest);

        vm.recordLogs();
        vm.prank(makeAddr("relayer"));
        AssayAccount(app).execute(address(REPUTATION), data, 1, deadline, abi.encodePacked(r, s, v));

        // NewFeedback(agentId indexed, clientAddress indexed, ...): the registry recorded the per-app address.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(REPUTATION) && logs[i].topics.length > 2) {
                assertEq(uint256(logs[i].topics[1]), HOST_AGENT);
                assertEq(address(uint160(uint256(logs[i].topics[2]))), app);
                found = true;
            }
        }
        assertTrue(found, "NewFeedback from the per-app address");
        assertEq(app.balance, 0, "still never funded");
    }
}
