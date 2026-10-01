// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// Records Chainlink CRE attestations of verifier grades, delivered by the CRE forwarder through `onReport`.
contract CreAttestor is IERC165 {
    struct Attestation {
        uint32 passed;
        uint32 total;
        uint16 ciLowBps;
        uint16 ciHighBps;
        bool agree;
    }

    // abi.encode of the 9 static report fields.
    uint256 internal constant REPORT_LENGTH = 9 * 32;

    address public immutable owner;
    address public forwarder;

    mapping(
        address verifier => mapping(bytes32 model => mapping(bytes32 hostKey => mapping(uint64 t => Attestation)))
    ) public attestations;

    event ForwarderSet(address indexed forwarder);
    event GradeAttested(
        address indexed verifier,
        bytes32 indexed model,
        bytes32 indexed hostKey,
        uint64 t,
        bool agree,
        uint32 passed,
        uint32 total
    );

    error NotOwner();
    error ForwarderAlreadySet();
    error NotForwarder();
    error BadReport();

    constructor(address owner_) {
        owner = owner_;
    }

    function setForwarder(address forwarder_) external {
        if (msg.sender != owner) revert NotOwner();
        if (forwarder != address(0)) revert ForwarderAlreadySet();
        forwarder = forwarder_;
        emit ForwarderSet(forwarder_);
    }

    /// CRE IReceiver entry point. `metadata` (workflow id, name, owner) is not checked: the forwarder is the trust anchor.
    function onReport(bytes calldata, bytes calldata report) external {
        if (msg.sender != forwarder) revert NotForwarder();
        if (report.length != REPORT_LENGTH) revert BadReport();
        (
            address verifier,
            bytes32 model,
            bytes32 hostKey,
            uint64 t,
            uint32 passed,
            uint32 total,
            uint16 ciLowBps,
            uint16 ciHighBps,
            bool agree
        ) = abi.decode(report, (address, bytes32, bytes32, uint64, uint32, uint32, uint16, uint16, bool));
        if (total == 0 || passed > total || ciLowBps > ciHighBps || ciHighBps > 10_000) revert BadReport();

        attestations[verifier][model][hostKey][t] = Attestation(passed, total, ciLowBps, ciHighBps, agree);
        emit GradeAttested(verifier, model, hostKey, t, agree, passed, total);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        // IReceiver has the single function onReport, so its interface id is that selector.
        return interfaceId == type(IERC165).interfaceId || interfaceId == CreAttestor.onReport.selector;
    }
}
