// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {AssayAccount} from "../src/AssayAccount.sol";

/// The EIP-7702 delegate for per-app requester keys. Stateless and ownerless, so one deploy per chain serves everyone.
/// forge script script/DeployAccount.s.sol --rpc-url monad_testnet --account assay-host --sender <assay-host address> --broadcast
contract DeployAccount is Script {
    function run() external returns (AssayAccount account) {
        vm.startBroadcast();
        account = new AssayAccount();
        vm.stopBroadcast();
        console.log("chainId      ", block.chainid);
        console.log("AssayAccount ", address(account));
    }
}
