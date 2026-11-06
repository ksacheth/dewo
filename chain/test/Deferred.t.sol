// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {EscrowFixture, TestToken} from "./EscrowFixture.sol";
import {MissionEscrow} from "../src/MissionEscrow.sol";

contract RejectingReceiver {
    bool public accept;

    function setAccept(bool value) external {
        accept = value;
    }

    receive() external payable {
        require(accept, "no HBAR");
    }

    function withdrawFrom(MissionEscrow escrow) external {
        escrow.withdraw();
    }
}

contract DeferredTokenTest is EscrowFixture {
    function _block(address account, TestToken.BlockMode mode) internal {
        token.setBlocked(account, true, mode);
    }

    function _settlePassWithBlockedWorker(TestToken.BlockMode mode) internal {
        _stake();
        _block(worker, mode);
        vm.warp(1090);
        uint256 requesterBefore = token.balanceOf(requester);
        vm.expectEmit(true, true, false, true);
        emit MissionEscrow.PayoutDeferred(missionId, worker, PRICE + STAKE);
        _settle(MissionEscrow.Outcome.Pass);
        assertEq(token.balanceOf(requester) - requesterBefore, BOUNTY - PRICE, "requester paid immediately");
        assertEq(escrow.owed(worker), PRICE + STAKE);
        assertEq(token.balanceOf(address(escrow)), PRICE + STAKE, "held = owed");
    }

    function _withdrawFlow() internal {
        vm.prank(worker);
        vm.expectRevert();
        escrow.withdraw();
        assertEq(escrow.owed(worker), PRICE + STAKE, "owed kept after failed withdraw");
        token.setBlocked(worker, false, TestToken.BlockMode.Revert);
        uint256 before = token.balanceOf(worker);
        vm.expectEmit(true, false, false, true);
        emit MissionEscrow.Withdrawn(worker, PRICE + STAKE);
        vm.prank(worker);
        escrow.withdraw();
        assertEq(token.balanceOf(worker) - before, PRICE + STAKE);
        assertEq(escrow.owed(worker), 0);
        assertEq(token.balanceOf(address(escrow)), 0);
        vm.prank(worker);
        vm.expectRevert(MissionEscrow.NothingOwed.selector);
        escrow.withdraw();
    }

    function testSettleDefersWhenTokenTransferReverts() public {
        _settlePassWithBlockedWorker(TestToken.BlockMode.Revert);
        _withdrawFlow();
    }

    function testSettleDefersWhenTokenTransferReturnsFalse() public {
        _settlePassWithBlockedWorker(TestToken.BlockMode.ReturnFalse);
        _withdrawFlow();
    }

    function testSettleDefersBlockedRequesterAndPaysWorker() public {
        _stake();
        _block(requester, TestToken.BlockMode.Revert);
        vm.warp(1090);
        uint256 workerBefore = token.balanceOf(worker);
        _settle(MissionEscrow.Outcome.Pass);
        assertEq(token.balanceOf(worker) - workerBefore, PRICE + STAKE);
        assertEq(escrow.owed(requester), BOUNTY - PRICE);
        assertEq(token.balanceOf(address(escrow)), BOUNTY - PRICE);
    }

    function testRescueDefersBlockedWorker() public {
        _stake();
        _block(worker, TestToken.BlockMode.ReturnFalse);
        vm.warp(4600);
        uint256 requesterBefore = token.balanceOf(requester);
        escrow.rescue(missionId);
        assertEq(token.balanceOf(requester) - requesterBefore, BOUNTY);
        assertEq(escrow.owed(worker), STAKE);
        assertEq(token.balanceOf(address(escrow)), STAKE);
        token.setBlocked(worker, false, TestToken.BlockMode.Revert);
        vm.prank(worker);
        escrow.withdraw();
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function testRescueDefersBlockedRequester() public {
        _stake();
        _block(requester, TestToken.BlockMode.Revert);
        vm.warp(4600);
        uint256 workerBefore = token.balanceOf(worker);
        escrow.rescue(missionId);
        assertEq(token.balanceOf(worker) - workerBefore, STAKE);
        assertEq(escrow.owed(requester), BOUNTY);
    }

    function testWithdrawWithNothingOwedReverts() public {
        vm.expectRevert(MissionEscrow.NothingOwed.selector);
        escrow.withdraw();
    }

    function testFuzzConservationWithOwed(uint96 priceInput, uint96 stakeInput, uint8 outcomeInput, bool blockWorker)
        public
    {
        uint256 price = bound(uint256(priceInput), 1, BOUNTY);
        uint256 bidStake = bound(uint256(stakeInput), 0, BOUNTY / 2);
        MissionEscrow.Outcome outcome = MissionEscrow.Outcome(bound(uint256(outcomeInput), 0, 4));
        vm.warp(1060);
        escrow.award(missionId, worker, price, bidStake, _sigs(escrow.awardDigest(missionId, worker, price, bidStake)));
        vm.prank(worker);
        escrow.stake(missionId);
        if (blockWorker) _block(worker, TestToken.BlockMode.ReturnFalse);
        vm.warp(1090);
        _settle(outcome);
        assertEq(token.balanceOf(address(escrow)), escrow.owed(worker) + escrow.owed(requester), "held = locked + owed");
        assertEq(token.balanceOf(requester) + token.balanceOf(worker) + token.balanceOf(address(escrow)), BOUNTY * 20);
    }
}

contract DeferredNativeTest is EscrowFixture {
    RejectingReceiver private bad;

    function setUp() public override {
        super.setUp();
        escrow = new MissionEscrow(address(0));
        bad = new RejectingReceiver();
        vm.deal(requester, BOUNTY * 10);
        vm.deal(worker, BOUNTY * 10);
    }

    function _create() internal {
        vm.prank(requester);
        missionId =
            escrow.createMission{value: BOUNTY}(keccak256("seed"), verifiers, deadlines, BOUNTY, DIFFICULTY, RISK_BPS);
    }

    function _awardTo(address who) internal {
        vm.warp(deadlines.biddingEndsAt);
        escrow.award(missionId, who, PRICE, STAKE, _sigs(escrow.awardDigest(missionId, who, PRICE, STAKE)));
    }

    function testSettleDefersRejectingWorkerAndPaysRequester() public {
        _create();
        _awardTo(address(bad));
        vm.deal(address(bad), STAKE);
        vm.prank(address(bad));
        escrow.stake{value: STAKE}(missionId);
        vm.warp(1090);
        uint256 requesterBefore = requester.balance;
        _settle(MissionEscrow.Outcome.Pass);
        assertEq(requester.balance - requesterBefore, BOUNTY - PRICE);
        assertEq(escrow.owed(address(bad)), PRICE + STAKE);
        assertEq(address(escrow).balance, PRICE + STAKE);

        vm.expectRevert(MissionEscrow.NativeTransferFailed.selector);
        bad.withdrawFrom(escrow);
        assertEq(escrow.owed(address(bad)), PRICE + STAKE);
        bad.setAccept(true);
        bad.withdrawFrom(escrow);
        assertEq(address(bad).balance, PRICE + STAKE);
        assertEq(address(escrow).balance, 0);
    }

    function testRescueDefersRejectingRequester() public {
        vm.deal(address(bad), BOUNTY);
        vm.prank(address(bad));
        missionId =
            escrow.createMission{value: BOUNTY}(keccak256("seed"), verifiers, deadlines, BOUNTY, DIFFICULTY, RISK_BPS);
        vm.warp(4600);
        escrow.rescue(missionId);
        assertEq(escrow.owed(address(bad)), BOUNTY);
        assertEq(address(escrow).balance, BOUNTY);
        bad.setAccept(true);
        bad.withdrawFrom(escrow);
        assertEq(address(escrow).balance, 0);
    }

    function testRescueStakedWithRejectingWorkerStillRefundsRequester() public {
        _create();
        _awardTo(address(bad));
        vm.deal(address(bad), STAKE);
        vm.prank(address(bad));
        escrow.stake{value: STAKE}(missionId);
        vm.warp(4600);
        uint256 requesterBefore = requester.balance;
        escrow.rescue(missionId);
        assertEq(requester.balance - requesterBefore, BOUNTY);
        assertEq(escrow.owed(address(bad)), STAKE);
    }
}
