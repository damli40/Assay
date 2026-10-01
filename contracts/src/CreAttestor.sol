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
    address public workflowOwner;
    // Zero accepts any workflow from workflowOwner.
    bytes32 public workflowId;

    mapping(
        address verifier => mapping(bytes32 model => mapping(bytes32 hostKey => mapping(uint64 t => Attestation)))
    ) public attestations;

    event Configured(address indexed forwarder, address indexed workflowOwner, bytes32 workflowId);
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
    error AlreadyConfigured();
    error BadConfig();
    error NotForwarder();
    error BadMetadata();
    error UnauthorizedWorkflow();
    error BadReport();

    constructor(address owner_) {
        owner = owner_;
    }

    /// One-time setup. The forwarder is shared by every CRE workflow, so reports are also pinned to our workflow.
    function configure(address forwarder_, address workflowOwner_, bytes32 workflowId_) external {
        if (msg.sender != owner) revert NotOwner();
        if (forwarder != address(0)) revert AlreadyConfigured();
        if (forwarder_ == address(0) || workflowOwner_ == address(0)) revert BadConfig();
        (forwarder, workflowOwner, workflowId) = (forwarder_, workflowOwner_, workflowId_);
        emit Configured(forwarder_, workflowOwner_, workflowId_);
    }

    /// CRE IReceiver entry point. KeystoneForwarder metadata is
    /// abi.encodePacked(bytes32 workflowId, bytes10 workflowName, address workflowOwner, bytes2 reportName).
    function onReport(bytes calldata metadata, bytes calldata report) external {
        if (msg.sender != forwarder) revert NotForwarder();
        if (metadata.length < 64) revert BadMetadata();
        bytes32 id = bytes32(metadata[0:32]);
        address wfOwner = address(bytes20(metadata[42:62]));
        if (wfOwner != workflowOwner || (workflowId != 0 && id != workflowId)) revert UnauthorizedWorkflow();
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
