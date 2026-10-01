// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ReceiptAnchor} from "../../src/ReceiptAnchor.sol";
import {VerifierRegistry} from "../../src/VerifierRegistry.sol";
import {IIdentityRegistry} from "../../src/interfaces/IIdentityRegistry.sol";

interface IIdentityRegistryFull is IIdentityRegistry {
    function register(string calldata agentURI) external returns (uint256 agentId);
    function getVersion() external view returns (string memory);
}

/// Runs against the real ERC-8004 IdentityRegistry on Monad testnet:
/// forge test --match-path "test/fork/*" --fork-url monad_testnet -vv
contract Erc8004ForkTest is Test {
    IIdentityRegistryFull internal constant IDENTITY =
        IIdentityRegistryFull(0x8004A818BFB912233c491871b3d84c89A494BD9e);
    uint256 internal constant HOST_PK = 0xA11CE;

    function setUp() public {
        // Skipped in plain `forge test` (no fork, so the registry has no code).
        if (address(IDENTITY).code.length == 0) vm.skip(true);
    }

    function test_fork_registryIsLive() public view {
        assertEq(block.chainid, 10143);
        assertEq(IDENTITY.getVersion(), "2.0.0");
    }

    function test_fork_registerAndSetHostKey() public {
        ReceiptAnchor ra = new ReceiptAnchor(IDENTITY, true);
        address host = makeAddr("fork-host");

        vm.prank(host);
        uint256 agentId = IDENTITY.register("https://example.com/agents/host.json");
        assertEq(IDENTITY.ownerOf(agentId), host);

        (uint256 x, uint256 y) = vm.publicKeyP256(HOST_PK);
        vm.prank(host);
        ra.setHostKey(agentId, bytes32(x), bytes32(y));

        bytes32 root = keccak256("fork batch");
        (bytes32 r, bytes32 s) = vm.signP256(HOST_PK, sha256(ra.anchorMessage(agentId, root, 1)));
        ra.anchor(agentId, root, 1, r, s);
        (, uint64 at) = ra.anchors(agentId, root);
        assertGt(at, 0);

        vm.prank(makeAddr("stranger"));
        vm.expectRevert(ReceiptAnchor.NotAgentOwner.selector);
        ra.setHostKey(agentId, bytes32(x), bytes32(y));
    }

    function test_fork_registerVerifierAndPostGrade() public {
        VerifierRegistry vr = new VerifierRegistry(IDENTITY);
        address verifier = makeAddr("fork-verifier");

        vm.startPrank(verifier);
        uint256 agentId = IDENTITY.register("https://example.com/agents/verifier.json");
        vr.registerVerifier(agentId);
        vr.postGrade(
            VerifierRegistry.Grade({
                model: keccak256("z-ai/glm-5.3"),
                hostKey: keccak256("openrouter:z-ai/fp8"),
                checks: keccak256("assay-checks/tool-calls-v0"),
                passed: 38,
                total: 40,
                ciLowBps: 8350,
                ciHighBps: 9860,
                refModel: keccak256("z-ai"),
                evidence: sha256("fork evidence"),
                t: uint64(block.timestamp)
            })
        );
        vm.stopPrank();

        address[] memory trusted = new address[](1);
        trusted[0] = verifier;
        (VerifierRegistry.Grade memory g, address by) =
            vr.gradeOf(keccak256("z-ai/glm-5.3"), keccak256("openrouter:z-ai/fp8"), trusted);
        assertEq(by, verifier);
        assertEq(g.passed, 38);
    }
}
