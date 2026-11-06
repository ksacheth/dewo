// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MissionEscrow} from "../src/MissionEscrow.sol";

/// @dev The MissionEscrow constructor calls the HTS system contract at 0x167, which Foundry's local
/// simulation does not have. Run with `--broadcast --skip-simulation` (see README).
contract DeployHedera is Script {
    function run() external returns (MissionEscrow escrow) {
        require(block.chainid == 296, "Hedera testnet only");
        address asset = vm.envOr("HEDERA_USE_HBAR", false) ? address(0) : vm.envAddress("HEDERA_USDC_ADDRESS");
        vm.startBroadcast(vm.envUint("HEDERA_PRIVATE_KEY"));
        escrow = new MissionEscrow(asset);
        vm.stopBroadcast();
        console2.log("MissionEscrow", address(escrow));
        console2.log("Settlement asset (zero = HBAR)", asset);
    }
}
