// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {EscrowFixture} from "./EscrowFixture.sol";
import {MissionEscrow} from "../src/MissionEscrow.sol";

contract ReenteringRequester {
    MissionEscrow private immutable escrow;
    bytes32 public missionId;
    bool public reentrySucceeded;

    constructor(MissionEscrow target) {
        escrow = target;
    }

    function create(address[3] calldata verifiers, MissionEscrow.Deadlines calldata deadlines) external payable {
        missionId =
            escrow.createMission{value: msg.value}(keccak256("seed"), verifiers, deadlines, msg.value, 1, 2500, 60, 0);
    }

    receive() external payable {
        (reentrySucceeded,) = address(escrow).call(abi.encodeCall(MissionEscrow.rescue, (missionId)));
    }
}

contract NativeEscrowTest is EscrowFixture {
    function setUp() public override {
        super.setUp();
        escrow = new MissionEscrow(address(0));
        vm.deal(requester, BOUNTY * 10);
        vm.deal(worker, BOUNTY * 10);
        vm.prank(requester);
        missionId = escrow.createMission{value: BOUNTY}(
            SEED, verifiers, deadlines, BOUNTY, DIFFICULTY, RISK_BPS, MAX_STEPS, MAX_COLLISIONS
        );
    }

    function _nativeStake() internal {
        _award();
        vm.prank(worker);
        escrow.stake{value: STAKE}(missionId);
    }

    function testNativeRejectsIncorrectBountyValue() public {
        vm.prank(requester);
        vm.expectRevert(MissionEscrow.InvalidAmount.selector);
        escrow.createMission{value: BOUNTY - 1}(
            SEED, verifiers, deadlines, BOUNTY, DIFFICULTY, RISK_BPS, MAX_STEPS, MAX_COLLISIONS
        );
    }

    function testNativeStakeMustEqualSignedAmount() public {
        _award();
        vm.prank(worker);
        vm.expectRevert(MissionEscrow.InvalidAmount.selector);
        escrow.stake{value: STAKE + 1}(missionId);
        vm.prank(worker);
        vm.expectRevert(MissionEscrow.InvalidAmount.selector);
        escrow.stake{value: STAKE - 1}(missionId);
        vm.prank(worker);
        escrow.stake{value: STAKE}(missionId);
    }

    function testFuzzNativeOutcomePayouts(uint8 choice) public {
        MissionEscrow.Outcome outcome = MissionEscrow.Outcome(bound(uint256(choice), 0, 2));
        _nativeStake();
        vm.warp(1090);
        _settle(outcome);
        bool paid = outcome == MissionEscrow.Outcome.Pass;
        assertEq(worker.balance, BOUNTY * 10 - STAKE + (paid ? PRICE + STAKE : 0));
        assertEq(requester.balance, BOUNTY * 9 + (paid ? BOUNTY - PRICE : BOUNTY + STAKE));
        assertEq(address(escrow).balance, 0);
    }

    function testNativeRescueReturnsBothDeposits() public {
        _nativeStake();
        vm.warp(4600);
        escrow.rescue(missionId);
        assertEq(requester.balance, BOUNTY * 10);
        assertEq(worker.balance, BOUNTY * 10);
    }

    function testRescueCallbackCannotReenterOrDrainAnotherMission() public {
        ReenteringRequester attacker = new ReenteringRequester(escrow);
        vm.deal(address(this), BOUNTY);
        attacker.create{value: BOUNTY}(verifiers, deadlines);
        vm.warp(4600);
        escrow.rescue(attacker.missionId());
        assertFalse(attacker.reentrySucceeded());
        assertEq(address(attacker).balance, BOUNTY);
        assertEq(address(escrow).balance, BOUNTY);
        escrow.rescue(missionId);
        assertEq(requester.balance, BOUNTY * 10);
    }
}
