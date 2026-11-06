// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {EpisodeRegistry} from "../src/EpisodeRegistry.sol";

contract EpisodeRegistryTest is Test {
    EpisodeRegistry internal registry;
    bytes32 internal constant MISSION = keccak256("mission");
    bytes32 internal constant LOG = keccak256("log");
    bytes32 internal constant POLICY = keccak256("policy");
    event EpisodeSubmitted(
        bytes32 indexed missionId,
        address indexed worker,
        bytes32 episodeLogRoot,
        bytes32 policyRoot,
        uint256 decisionCount
    );

    function setUp() public {
        registry = new EpisodeRegistry();
    }

    function testRecordsSubmissionAndEvent() public {
        vm.warp(12345);
        vm.expectEmit(true, true, false, true, address(registry));
        emit EpisodeSubmitted(MISSION, address(this), LOG, POLICY, 15);
        registry.submitEpisode(MISSION, LOG, POLICY, 15);
        (bytes32 logRoot, bytes32 policyRoot, uint256 count, uint256 timestamp, bool exists) =
            registry.submissions(MISSION, address(this));
        assertEq(logRoot, LOG);
        assertEq(policyRoot, POLICY);
        assertEq(count, 15);
        assertEq(timestamp, 12345);
        assertTrue(exists);
    }

    function testCannotOverwriteFirstSubmission() public {
        registry.submitEpisode(MISSION, LOG, POLICY, 15);
        vm.expectRevert(EpisodeRegistry.AlreadySubmitted.selector);
        registry.submitEpisode(MISSION, keccak256("new"), POLICY, 14);
    }

    function testOtherWalletCannotOccupyWinnerSlot() public {
        vm.prank(address(0xBAD));
        registry.submitEpisode(MISSION, LOG, POLICY, 15);
        registry.submitEpisode(MISSION, LOG, POLICY, 10);
        (,, uint256 count,, bool exists) = registry.submissions(MISSION, address(this));
        assertTrue(exists);
        assertEq(count, 10);
    }

    function testImmediateSafeStopCanSubmitZeroDecisions() public {
        registry.submitEpisode(MISSION, LOG, POLICY, 0);
        (,, uint256 count,, bool exists) = registry.submissions(MISSION, address(this));
        assertTrue(exists);
        assertEq(count, 0);
    }

    function testEmptyRootRejected() public {
        vm.expectRevert(EpisodeRegistry.InvalidSubmission.selector);
        registry.submitEpisode(MISSION, bytes32(0), POLICY, 1);
    }
}
