// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MissionEscrow} from "../src/MissionEscrow.sol";

/// @dev Not usable for a live Hedera deploy: forge script always runs run() on a local fork first, where the
/// HTS system contract at 0x167 is not real code, so the constructor's associateToken reverts. Deploy with
/// `forge create` instead (see README). Kept for its chain and asset checks.
contract DeployHedera is Script {
    function run() external returns (MissionEscrow escrow) {
        require(block.chainid == 296, "Hedera testnet only");
        address asset;
        if (!vm.envOr("HEDERA_USE_HBAR", false)) {
            asset = vm.envOr("HEDERA_USDC_ADDRESS", address(0));
            require(asset != address(0), "Set HEDERA_USDC_ADDRESS, or HEDERA_USE_HBAR=true for a native HBAR escrow");
        }
        vm.startBroadcast(vm.envUint("HEDERA_PRIVATE_KEY"));
        escrow = new MissionEscrow(asset);
        vm.stopBroadcast();
        console2.log("MissionEscrow", address(escrow));
        console2.log("Settlement asset (zero = HBAR)", asset);
    }
}
