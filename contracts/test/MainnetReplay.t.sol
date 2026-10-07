// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ReceiptAnchor} from "../src/ReceiptAnchor.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import {IIdentityRegistry} from "../src/interfaces/IIdentityRegistry.sol";
import {MockIdentityRegistry} from "./mocks/MockIdentityRegistry.sol";

/// Replays two real Monad mainnet transactions, byte for byte, with no RPC: the host's anchor of a batch, then a
/// requester's browser passkey co-sign of a receipt in it. ReceiptAnchor is placed at its mainnet address and the
/// chain id is set to 143, because the host's batch signature covers both. So a real WebAuthn assertion from a real
/// browser (low-s normalised, real clientDataJSON and authenticatorData) is checked in CI on every run.
contract MainnetReplayTest is Test {
    address internal constant MAINNET_ANCHOR = 0x049A73755cA3508ef3Daa4752A3406f6e00CfB13;
    ReceiptAnchor internal ra;
    bytes internal anchorInput;
    bytes internal cosignInput;
    bytes32 internal receiptHash;
    bytes32 internal cosigner;
    bytes32 internal root;

    function setUp() public {
        string memory j = vm.readFile("test/fixtures/mainnet_cosign.json");
        anchorInput = vm.parseJsonBytes(j, ".anchorInput");
        cosignInput = vm.parseJsonBytes(j, ".cosignInput");
        receiptHash = vm.parseJsonBytes32(j, ".receiptHash");
        cosigner = vm.parseJsonBytes32(j, ".cosigner");
        root = vm.parseJsonBytes32(j, ".root");
        uint256 agentId = vm.parseJsonUint(j, ".agentId");

        vm.chainId(143);
        MockIdentityRegistry reg = new MockIdentityRegistry();
        reg.setOwner(agentId, address(this));
        deployCodeTo("ReceiptAnchor.sol:ReceiptAnchor", abi.encode(IIdentityRegistry(address(reg)), true), MAINNET_ANCHOR);
        ra = ReceiptAnchor(MAINNET_ANCHOR);
        ra.setHostKey(agentId, vm.parseJsonBytes32(j, ".hostQx"), vm.parseJsonBytes32(j, ".hostQy"));
    }

    function _send(bytes memory input) internal returns (bool ok, bytes memory ret) {
        (ok, ret) = address(ra).call(input);
    }

    function test_replay_realAnchor_thenRealPasskeyCosign() public {
        (bool ok,) = _send(anchorInput);
        assertTrue(ok, "real host anchor verifies under chain 143 at the real address");
        (ok,) = _send(cosignInput);
        assertTrue(ok, "real browser passkey assertion verifies onchain");
        assertTrue(ra.cosigned(receiptHash, cosigner), "co-signed by exactly the key the receipt names");
    }

    function test_replay_cosignTwice_reverts() public {
        _send(anchorInput);
        _send(cosignInput);
        (bool ok, bytes memory ret) = _send(cosignInput);
        assertFalse(ok);
        assertEq(bytes4(ret), ReceiptAnchor.AlreadyCosigned.selector);
    }

    function test_replay_cosignBeforeAnchor_reverts() public {
        (bool ok, bytes memory ret) = _send(cosignInput);
        assertFalse(ok);
        assertEq(bytes4(ret), ReceiptAnchor.ReceiptNotAnchored.selector);
    }

    function test_replay_anchorOnAnotherChain_reverts() public {
        vm.chainId(10143);
        (bool ok, bytes memory ret) = _send(anchorInput);
        assertFalse(ok, "the batch signature is bound to chain 143");
        assertEq(bytes4(ret), ReceiptAnchor.BadHostSignature.selector);
    }

    struct Cosign {
        uint256 agentId;
        bytes32 receiptHash;
        bytes32[] proof;
        bytes32 root;
        WebAuthn.WebAuthnAuth auth;
        bytes32 qx;
        bytes32 qy;
    }

    function _decoded() internal view returns (Cosign memory c) {
        bytes memory args = new bytes(cosignInput.length - 4);
        for (uint256 i; i < args.length; i++) args[i] = cosignInput[i + 4];
        (c.agentId, c.receiptHash, c.proof, c.root, c.auth, c.qx, c.qy) =
            abi.decode(args, (uint256, bytes32, bytes32[], bytes32, WebAuthn.WebAuthnAuth, bytes32, bytes32));
    }

    function _tries(Cosign memory c) internal returns (bool ok) {
        try ra.cosign(c.agentId, c.receiptHash, c.proof, c.root, c.auth, c.qx, c.qy) {
            ok = true;
        } catch {}
    }

    function test_replay_decodedAssertion_isTheRealOne() public {
        _send(anchorInput);
        Cosign memory c = _decoded();
        assertEq(c.receiptHash, receiptHash);
        assertEq(c.root, root);
        assertTrue(_tries(c), "re-encoding the decoded real assertion still verifies");
    }

    function test_replay_everyByteOfClientDataAndAuthData_isBound() public {
        _send(anchorInput);
        Cosign memory c = _decoded();
        bytes memory cd = bytes(c.auth.clientDataJSON);
        for (uint256 i; i < cd.length; i++) {
            Cosign memory m = _decoded();
            bytes memory b = bytes(m.auth.clientDataJSON);
            b[i] = b[i] ^ 0x01;
            m.auth.clientDataJSON = string(b);
            assertFalse(_tries(m), "clientDataJSON byte");
        }
        for (uint256 i; i < c.auth.authenticatorData.length; i++) {
            Cosign memory m = _decoded();
            m.auth.authenticatorData[i] = m.auth.authenticatorData[i] ^ 0x01;
            assertFalse(_tries(m), "authenticatorData byte");
        }
        assertFalse(ra.cosigned(receiptHash, cosigner));
    }

    function test_replay_signatureKeyAndIndexes_areBound() public {
        _send(anchorInput);
        Cosign memory m = _decoded();
        m.auth.r = m.auth.r ^ bytes32(uint256(1));
        assertFalse(_tries(m), "r");
        m = _decoded();
        m.auth.s = m.auth.s ^ bytes32(uint256(1));
        assertFalse(_tries(m), "s");
        m = _decoded();
        m.auth.challengeIndex += 1;
        assertFalse(_tries(m), "challengeIndex");
        m = _decoded();
        m.auth.typeIndex += 1;
        assertFalse(_tries(m), "typeIndex");
        m = _decoded();
        m.qx = m.qx ^ bytes32(uint256(1));
        assertFalse(_tries(m), "qx");
        m = _decoded();
        m.receiptHash = keccak256("another receipt");
        assertFalse(_tries(m), "receiptHash");
        assertTrue(_tries(_decoded()), "the untouched assertion still works afterwards");
    }
}
