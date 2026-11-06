// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {EpisodeRegistry} from "../src/EpisodeRegistry.sol";

contract Deploy0G is Script {
    function run() external returns (EpisodeRegistry registry) {
        require(block.chainid == 16602, "0G Galileo only");
        vm.startBroadcast(vm.envUint("OG_PRIVATE_KEY"));
        registry = new EpisodeRegistry();
        vm.stopBroadcast();
        console2.log("EpisodeRegistry", address(registry));
    }
}
