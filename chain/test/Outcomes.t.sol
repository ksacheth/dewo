// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {EscrowFixture} from "./EscrowFixture.sol";
import {MissionEscrow} from "../src/MissionEscrow.sol";

contract OutcomesTest is EscrowFixture {
    function _check(MissionEscrow.Outcome outcome, bool paysWorker) internal {
        _stake();
        vm.warp(1090);
        uint256 requesterBefore = token.balanceOf(requester);
        uint256 workerBefore = token.balanceOf(worker);
        _settle(outcome);
        assertEq(token.balanceOf(worker) - workerBefore, paysWorker ? PRICE + STAKE : 0);
        assertEq(token.balanceOf(requester) - requesterBefore, paysWorker ? BOUNTY - PRICE : BOUNTY + STAKE);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function testPass() public {
        _check(MissionEscrow.Outcome.Pass, true);
    }

    function testOutcomeFail() public {
        _check(MissionEscrow.Outcome.Fail, false);
    }

    function testNoShow() public {
        _check(MissionEscrow.Outcome.NoShow, false);
    }

    function testInvalidCourse() public {
        _check(MissionEscrow.Outcome.InvalidCourse, true);
    }

    function testNoSeedRelease() public {
        _check(MissionEscrow.Outcome.NoSeedRelease, true);
    }

    function testRescueStakedMission() public {
        _stake();
        vm.warp(4600);
        escrow.rescue(missionId);
        assertEq(token.balanceOf(worker), BOUNTY * 10);
        assertEq(token.balanceOf(requester), BOUNTY * 10);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function testRescueUnawardedMission() public {
        vm.warp(4600);
        escrow.rescue(missionId);
        assertEq(token.balanceOf(requester), BOUNTY * 10);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function testRescueExpiredAwardDoesNotPayUndepositedStake() public {
        _award();
        vm.warp(4600);
        escrow.rescue(missionId);
        assertEq(token.balanceOf(worker), BOUNTY * 10);
        assertEq(token.balanceOf(requester), BOUNTY * 10);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function testFuzzConservationAndMissionIsolation(
        uint96 bountyInput,
        uint96 priceInput,
        uint96 stakeInput,
        uint8 outcomeInput
    ) public {
        uint256 bounty = bound(uint256(bountyInput), 1, 1e24);
        uint256 price = bound(uint256(priceInput), 1, bounty);
        uint256 bidStake = bound(uint256(stakeInput), 0, bounty / 2);
        MissionEscrow.Outcome outcome = MissionEscrow.Outcome(bound(uint256(outcomeInput), 0, 4));
        token.mint(requester, bounty);
        token.mint(worker, bidStake);
        vm.prank(requester);
        bytes32 second = escrow.createMission(keccak256("second"), verifiers, deadlines, bounty);
        assertNotEq(second, missionId);
        vm.warp(1060);
        escrow.award(second, worker, price, bidStake, _sigs(escrow.awardDigest(second, worker, price, bidStake)));
        vm.prank(worker);
        escrow.stake(second);
        uint256 beforeSum = token.balanceOf(requester) + token.balanceOf(worker);
        vm.warp(1090);
        escrow.settle(second, outcome, EVIDENCE, _sigs(escrow.verdictDigest(second, outcome, EVIDENCE)));
        assertEq(token.balanceOf(requester) + token.balanceOf(worker) - beforeSum, bounty + bidStake);
        assertEq(token.balanceOf(address(escrow)), BOUNTY, "other Mission remains fully funded");
    }
}
