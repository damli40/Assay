// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// EIP-7702 delegate for per-app requester keys. An EOA that points its code here lets anyone (a relayer)
/// submit a call on its behalf, as long as the EOA's own key signed that exact call. The relayer pays the
/// gas, so a per-app address never holds MON and is never linked onchain to the wallet that would fund it.
///
/// The EIP-712 domain uses `address(this)`, which under delegation is the EOA itself, so a signature is
/// bound to one account on one chain. Called on this contract directly, no signature recovers to
/// `address(this)`, so the implementation itself can't be driven.
contract AssayAccount is EIP712 {
    bytes32 public constant CALL_TYPEHASH = keccak256("Call(address target,bytes data,uint256 nonce,uint256 deadline)");

    /// @custom:storage-location erc7201:assay.account
    struct Layout {
        mapping(uint256 nonce => bool) used;
    }

    // keccak256(abi.encode(uint256(keccak256("assay.account")) - 1)) & ~bytes32(uint256(0xff)).
    // Namespaced, because the EOA's storage outlives this delegation and may later serve other code.
    bytes32 private constant LAYOUT_SLOT = 0x0399c39ec0624537af29b0ab72c6a3cb2ee7f8c3f89d938aff08eeeb0dbae500;

    event Executed(uint256 indexed nonce, address indexed target);

    error Expired();
    error NonceUsed();
    error BadSigner();
    error CallFailed(bytes reason);

    constructor() EIP712("AssayAccount", "1") {}

    /// Runs `target.call(data)` from this account. Nonces are unordered: any unused value works once,
    /// so a relayer can't block one call by withholding another.
    function execute(address target, bytes calldata data, uint256 nonce, uint256 deadline, bytes calldata signature)
        external
        returns (bytes memory result)
    {
        if (block.timestamp > deadline) revert Expired();
        Layout storage l = _layout();
        if (l.used[nonce]) revert NonceUsed();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CALL_TYPEHASH, target, keccak256(data), nonce, deadline)));
        // OZ's recover rejects malformed and high-s signatures.
        if (ECDSA.recover(digest, signature) != address(this)) revert BadSigner();
        l.used[nonce] = true;
        bool ok;
        (ok, result) = target.call(data);
        if (!ok) revert CallFailed(result);
        emit Executed(nonce, target);
    }

    function nonceUsed(uint256 nonce) external view returns (bool) {
        return _layout().used[nonce];
    }

    function _layout() private pure returns (Layout storage l) {
        assembly {
            l.slot := LAYOUT_SLOT
        }
    }
}
