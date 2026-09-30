// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

/// Requester co-signature: challenge = receiptHash (SPEC section 4).
contract WebAuthnTest is Test {
    uint256 internal constant N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    uint256 internal constant PK = 0xC0FFEE;
    bytes1 internal constant UP = 0x01;
    bytes1 internal constant UV = 0x04;
    uint256 internal constant TYPE_INDEX = 1; // '{' is byte 0
    uint256 internal constant CHALLENGE_INDEX = 23; // 1 + len('"type":"webauthn.get",')

    bytes32 internal receiptHash = sha256("assay-receipt/0 example body");
    bytes32 internal qx;
    bytes32 internal qy;

    function setUp() public {
        (uint256 x, uint256 y) = vm.publicKeyP256(PK);
        (qx, qy) = (bytes32(x), bytes32(y));
    }

    function _clientData(string memory typ, bytes32 challenge, string memory origin) internal pure returns (string memory) {
        return string.concat(
            '{"type":"', typ, '","challenge":"', Base64.encodeURL(abi.encodePacked(challenge)),
            '","origin":"', origin, '","crossOrigin":false}'
        );
    }

    function _authData(bytes1 flags, uint32 counter) internal pure returns (bytes memory) {
        return abi.encodePacked(sha256("assay.example"), flags, counter); // 37 bytes
    }

    function _sign(uint256 pk, bytes memory authData, string memory cdj) internal pure returns (WebAuthn.WebAuthnAuth memory a) {
        bytes32 h = sha256(abi.encodePacked(authData, sha256(bytes(cdj))));
        (bytes32 r, bytes32 s) = vm.signP256(pk, h);
        a = WebAuthn.WebAuthnAuth({r: r, s: s, challengeIndex: CHALLENGE_INDEX, typeIndex: TYPE_INDEX, authenticatorData: authData, clientDataJSON: cdj});
    }

    function _valid() internal view returns (WebAuthn.WebAuthnAuth memory) {
        return _sign(PK, _authData(UP | UV, 1), _clientData("webauthn.get", receiptHash, "https://assay.example"));
    }

    function _check(WebAuthn.WebAuthnAuth memory a) internal view returns (bool) {
        return WebAuthn.verify(abi.encodePacked(receiptHash), a, qx, qy, true);
    }

    function test_valid() public view {
        assertTrue(_check(_valid()));
    }

    function test_valid_usesPrecompile_gasBound() public view {
        WebAuthn.WebAuthnAuth memory a = _valid();
        uint256 g = gasleft();
        assertTrue(_check(a));
        assertLt(g - gasleft(), 60_000, "too much gas: Solidity fallback ran instead of 0x0100");
    }

    function test_wrongChallenge() public view {
        assertFalse(_check(_sign(PK, _authData(UP | UV, 1), _clientData("webauthn.get", sha256("other receipt"), "https://assay.example"))));
    }

    function test_tamperedClientDataJSON() public view {
        WebAuthn.WebAuthnAuth memory a = _valid();
        a.clientDataJSON = _clientData("webauthn.get", receiptHash, "https://assay.exampl3"); // one byte changed after signing
        assertFalse(_check(a));
    }

    function test_wrongType() public view {
        assertFalse(_check(_sign(PK, _authData(UP | UV, 1), _clientData("webauthn.create", receiptHash, "https://assay.example"))));
    }

    function test_missingUserPresentFlag() public view {
        assertFalse(_check(_sign(PK, _authData(UV, 1), _clientData("webauthn.get", receiptHash, "https://assay.example"))));
    }

    function test_missingUserVerified_whenRequired() public view {
        assertFalse(_check(_sign(PK, _authData(UP, 1), _clientData("webauthn.get", receiptHash, "https://assay.example"))));
    }

    function test_tamperedAuthenticatorData() public view {
        WebAuthn.WebAuthnAuth memory a = _valid();
        a.authenticatorData = _authData(UP | UV, 2); // counter changed after signing
        assertFalse(_check(a));
    }

    function test_wrongKey() public view {
        WebAuthn.WebAuthnAuth memory a = _sign(0xBAD, _authData(UP | UV, 1), _clientData("webauthn.get", receiptHash, "https://assay.example"));
        assertFalse(_check(a));
    }

    function test_highS_rejected() public view {
        WebAuthn.WebAuthnAuth memory a = _valid();
        a.s = bytes32(N - uint256(a.s));
        assertFalse(_check(a));
    }

    function test_shortAuthenticatorData() public view {
        WebAuthn.WebAuthnAuth memory a = _valid();
        a.authenticatorData = hex"00";
        assertFalse(_check(a));
    }

    function testFuzz_anyReceiptHash(bytes32 rh) public view {
        WebAuthn.WebAuthnAuth memory a = _sign(PK, _authData(UP | UV, 7), _clientData("webauthn.get", rh, "https://assay.example"));
        assertTrue(WebAuthn.verify(abi.encodePacked(rh), a, qx, qy, true));
    }
}
