// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";

/// Day 1: prove the P256VERIFY precompile (0x0100, EIP-7951) is reachable and behaves as documented.
contract P256Test is Test {
    address internal constant P256VERIFY = address(0x100);
    uint256 internal constant N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;

    // Wycheproof ecdsa_secp256r1_sha256_p1363 vector (the same one OpenZeppelin's P256 uses to probe the precompile).
    bytes32 internal constant H = 0xbb5a52f42f9c9261ed4361f59422a1e30036e7c32b270c8807a419feca605023; // sha256("123400")
    bytes32 internal constant R = bytes32(uint256(5));
    bytes32 internal constant S = bytes32(uint256(1));
    bytes32 internal constant QX = 0xa71af64de5126a4a4e02b7922d66ce9415ce88a4c9d25514d91082c8725ac957;
    bytes32 internal constant QY = 0x5d47723c8fbe580bb369fec9c2665d8e30a435b9932645482e7c9f11e872296b;

    function _raw(bytes32 h, bytes32 r, bytes32 s, bytes32 x, bytes32 y) internal view returns (bytes memory ret) {
        bool ok;
        (ok, ret) = P256VERIFY.staticcall(abi.encodePacked(h, r, s, x, y));
        assertTrue(ok, "staticcall failed");
    }

    function test_precompile_knownVector_returnsOne() public view {
        bytes memory ret = _raw(H, R, S, QX, QY);
        assertEq(ret.length, 32, "0x0100 missing: check evm_version / network in foundry.toml");
        assertEq(uint256(bytes32(ret)), 1);
    }

    function test_precompile_tamperedHash_returnsEmpty() public view {
        assertEq(_raw(H ^ bytes32(uint256(1)), R, S, QX, QY).length, 0);
    }

    function test_signP256_roundTrip() public view {
        uint256 pk = uint256(keccak256("assay-day1-host-key")) % (N - 1) + 1;
        (uint256 x, uint256 y) = vm.publicKeyP256(pk);
        bytes32 digest = sha256("assay receipt v0");
        (bytes32 r, bytes32 s) = vm.signP256(pk, digest);
        assertTrue(P256.verifyNative(digest, r, s, bytes32(x), bytes32(y)), "native (precompile) path");
        assertTrue(P256.verify(digest, r, s, bytes32(x), bytes32(y)), "verify with fallback");
    }

    function test_wrongKey_fails() public view {
        uint256 pk = 0xA11CE;
        (uint256 x, uint256 y) = vm.publicKeyP256(0xB0B);
        bytes32 digest = sha256("assay receipt v0");
        (bytes32 r, bytes32 s) = vm.signP256(pk, digest);
        assertFalse(P256.verify(digest, r, s, bytes32(x), bytes32(y)));
    }

    /// The raw precompile accepts both s and N - s. OpenZeppelin rejects the high one, so SDKs must normalize to low-s.
    function test_highS_acceptedByPrecompile_rejectedByOZ() public view {
        uint256 pk = 0xA11CE;
        (uint256 x, uint256 y) = vm.publicKeyP256(pk);
        bytes32 digest = sha256("malleable");
        (bytes32 r, bytes32 s) = vm.signP256(pk, digest); // Foundry returns low-s
        bytes32 highS = bytes32(N - uint256(s));
        assertEq(uint256(bytes32(_raw(digest, r, highS, bytes32(x), bytes32(y)))), 1);
        assertFalse(P256.verify(digest, r, highS, bytes32(x), bytes32(y)));
    }

    function testFuzz_signVerify(uint256 pkSeed, bytes32 digest) public view {
        uint256 pk = bound(pkSeed, 1, N - 1);
        (uint256 x, uint256 y) = vm.publicKeyP256(pk);
        (bytes32 r, bytes32 s) = vm.signP256(pk, digest);
        assertTrue(P256.verify(digest, r, s, bytes32(x), bytes32(y)));
    }
}
