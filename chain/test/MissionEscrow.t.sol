// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {EscrowFixture} from "./EscrowFixture.sol";
import {MissionEscrow} from "../src/MissionEscrow.sol";
import {IHederaTokenService} from "../src/interfaces/IHederaTokenService.sol";

contract MissionEscrowTest is EscrowFixture {
    function testCreateLocksBountyAndStoresConfiguration() public view {
        MissionEscrow.Mission memory m = escrow.getMission(missionId);
        assertEq(m.requester, requester);
        assertEq(m.maxBounty, BOUNTY);
        assertEq(m.verifiers[2], verifiers[2]);
        assertEq(m.deadlines.rescueAt, 4600);
        assertEq(uint256(m.state), uint256(MissionEscrow.State.Created));
        assertEq(token.balanceOf(address(escrow)), BOUNTY);
    }

    function testRejectDuplicateVerifiers() public {
        verifiers[1] = verifiers[0];
        vm.expectRevert(MissionEscrow.InvalidConfiguration.selector);
        escrow.createMission(keccak256("seed"), verifiers, deadlines, BOUNTY);
    }

    function testRejectZeroVerifier() public {
        verifiers[0] = address(0);
        vm.expectRevert(MissionEscrow.InvalidConfiguration.selector);
        escrow.createMission(keccak256("seed"), verifiers, deadlines, BOUNTY);
    }

    function testRejectDeadlinesWithoutTimeForEpisode() public {
        deadlines.rescueAt = 1420;
        vm.expectRevert(MissionEscrow.InvalidTime.selector);
        escrow.createMission(keccak256("seed"), verifiers, deadlines, BOUNTY);
    }

    function testAssociationFailureRevertsDeployment() public {
        vm.mockCall(
            address(0x167), abi.encodeWithSelector(IHederaTokenService.associateToken.selector), abi.encode(int64(125))
        );
        vm.expectRevert(abi.encodeWithSelector(MissionEscrow.AssociationFailed.selector, int64(125)));
        new MissionEscrow(address(token));
    }

    function testAwardRequiresBiddingToClose() public {
        bytes[2] memory signatures = _sigs(escrow.awardDigest(missionId, worker, PRICE, STAKE));
        vm.warp(1059);
        vm.expectRevert(MissionEscrow.InvalidTime.selector);
        escrow.award(missionId, worker, PRICE, STAKE, signatures);
        vm.warp(1060);
        escrow.award(missionId, worker, PRICE, STAKE, signatures);
    }

    function testAwardRejectsWrongSigner() public {
        vm.warp(1060);
        bytes32 digest = escrow.awardDigest(missionId, worker, PRICE, STAKE);
        bytes[2] memory signatures = _sigs(digest);
        signatures[1] = _sign(digest, 44);
        vm.expectRevert(MissionEscrow.InvalidQuorum.selector);
        escrow.award(missionId, worker, PRICE, STAKE, signatures);
    }

    function testAwardRejectsDuplicateSigner() public {
        vm.warp(1060);
        bytes[2] memory signatures = _sigs(escrow.awardDigest(missionId, worker, PRICE, STAKE));
        signatures[1] = signatures[0];
        vm.expectRevert(MissionEscrow.InvalidQuorum.selector);
        escrow.award(missionId, worker, PRICE, STAKE, signatures);
    }

    function testAwardRejectsMissingSignature() public {
        vm.warp(1060);
        bytes[2] memory signatures = _sigs(escrow.awardDigest(missionId, worker, PRICE, STAKE));
        signatures[1] = "";
        vm.expectRevert();
        escrow.award(missionId, worker, PRICE, STAKE, signatures);
    }

    function testAwardRejectsTamperedStake() public {
        vm.warp(1060);
        bytes[2] memory signatures = _sigs(escrow.awardDigest(missionId, worker, PRICE, STAKE));
        vm.expectRevert(MissionEscrow.InvalidQuorum.selector);
        escrow.award(missionId, worker, PRICE, STAKE + 1, signatures);
    }

    function testAwardRejectsWrongChainDomain() public {
        vm.warp(1060);
        bytes[2] memory signatures = _sigs(escrow.awardDigest(missionId, worker, PRICE, STAKE));
        vm.chainId(16602);
        vm.expectRevert(MissionEscrow.InvalidQuorum.selector);
        escrow.award(missionId, worker, PRICE, STAKE, signatures);
    }

    function testAwardRejectsWrongContractDomain() public {
        vm.warp(1060);
        MissionEscrow other = new MissionEscrow(address(token));
        bytes[2] memory signatures = _sigs(other.awardDigest(missionId, worker, PRICE, STAKE));
        vm.expectRevert(MissionEscrow.InvalidQuorum.selector);
        escrow.award(missionId, worker, PRICE, STAKE, signatures);
    }

    function testAwardRejectsWrongMission() public {
        vm.warp(1060);
        bytes[2] memory signatures = _sigs(escrow.awardDigest(bytes32(uint256(99)), worker, PRICE, STAKE));
        vm.expectRevert(MissionEscrow.InvalidQuorum.selector);
        escrow.award(missionId, worker, PRICE, STAKE, signatures);
    }

    function testAwardRejectsPriceAboveBounty() public {
        vm.warp(1060);
        bytes[2] memory signatures = _sigs(escrow.awardDigest(missionId, worker, BOUNTY + 1, STAKE));
        vm.expectRevert(MissionEscrow.InvalidAmount.selector);
        escrow.award(missionId, worker, BOUNTY + 1, STAKE, signatures);
    }

    function testAwardRejectsInsufficientTimeBeforeRescue() public {
        vm.warp(4240);
        bytes[2] memory signatures = _sigs(escrow.awardDigest(missionId, worker, PRICE, STAKE));
        vm.expectRevert(MissionEscrow.InvalidTime.selector);
        escrow.award(missionId, worker, PRICE, STAKE, signatures);
    }

    function testReplacementAwardFailsClosedPendingRoundAmendment() public {
        _award();
        vm.warp(1090);
        bytes[2] memory signatures = _sigs(escrow.awardDigest(missionId, address(0x300), PRICE, STAKE));
        vm.expectRevert(MissionEscrow.InvalidState.selector);
        escrow.award(missionId, address(0x300), PRICE, STAKE, signatures);
    }

    function testStakeCollectsExactlySignedAmount() public {
        _stake();
        assertEq(token.balanceOf(address(escrow)), BOUNTY + STAKE);
        assertEq(token.balanceOf(worker), BOUNTY * 10 - STAKE);
        assertEq(uint256(escrow.getMission(missionId).state), uint256(MissionEscrow.State.Staked));
        vm.prank(worker);
        vm.expectRevert(MissionEscrow.InvalidState.selector);
        escrow.stake(missionId);
    }

    function testStakeOnlyWinner() public {
        _award();
        vm.expectRevert(MissionEscrow.NotWorker.selector);
        escrow.stake(missionId);
    }

    function testStakeDeadlineBoundary() public {
        _award();
        vm.warp(1090);
        vm.prank(worker);
        vm.expectRevert(MissionEscrow.InvalidTime.selector);
        escrow.stake(missionId);
    }

    function testStakeJustBeforeDeadline() public {
        _award();
        vm.warp(1089);
        vm.prank(worker);
        escrow.stake(missionId);
    }

    function testZeroStakeStillRequiresWorkerConfirmation() public {
        vm.warp(1060);
        escrow.award(missionId, worker, PRICE, 0, _sigs(escrow.awardDigest(missionId, worker, PRICE, 0)));
        bytes[2] memory signatures = _sigs(escrow.verdictDigest(missionId, MissionEscrow.Outcome.Pass, EVIDENCE));
        vm.expectRevert(MissionEscrow.InvalidState.selector);
        escrow.settle(missionId, MissionEscrow.Outcome.Pass, EVIDENCE, signatures);
        vm.prank(worker);
        escrow.stake(missionId);
        _settle(MissionEscrow.Outcome.Pass);
    }

    function testVerdictRejectsDifferentEvidence() public {
        _stake();
        bytes[2] memory signatures = _sigs(escrow.verdictDigest(missionId, MissionEscrow.Outcome.Pass, EVIDENCE));
        vm.expectRevert(MissionEscrow.InvalidQuorum.selector);
        escrow.settle(missionId, MissionEscrow.Outcome.Pass, keccak256("other"), signatures);
    }

    function testVerdictRejectsDifferentOutcome() public {
        _stake();
        bytes[2] memory signatures = _sigs(escrow.verdictDigest(missionId, MissionEscrow.Outcome.Pass, EVIDENCE));
        vm.expectRevert(MissionEscrow.InvalidQuorum.selector);
        escrow.settle(missionId, MissionEscrow.Outcome.Fail, EVIDENCE, signatures);
    }

    function testVerdictRejectsDuplicateSigner() public {
        _stake();
        bytes[2] memory signatures = _sigs(escrow.verdictDigest(missionId, MissionEscrow.Outcome.Pass, EVIDENCE));
        signatures[1] = signatures[0];
        vm.expectRevert(MissionEscrow.InvalidQuorum.selector);
        escrow.settle(missionId, MissionEscrow.Outcome.Pass, EVIDENCE, signatures);
    }

    function testNoSeedReleaseCannotSettleEarly() public {
        _stake();
        bytes[2] memory signatures =
            _sigs(escrow.verdictDigest(missionId, MissionEscrow.Outcome.NoSeedRelease, EVIDENCE));
        vm.warp(1089);
        vm.expectRevert(MissionEscrow.InvalidTime.selector);
        escrow.settle(missionId, MissionEscrow.Outcome.NoSeedRelease, EVIDENCE, signatures);
        vm.warp(1090);
        escrow.settle(missionId, MissionEscrow.Outcome.NoSeedRelease, EVIDENCE, signatures);
    }

    function testRescueBoundaryExcludesSettlement() public {
        _stake();
        vm.warp(4599);
        vm.expectRevert(MissionEscrow.InvalidTime.selector);
        escrow.rescue(missionId);
        bytes[2] memory signatures = _sigs(escrow.verdictDigest(missionId, MissionEscrow.Outcome.Pass, EVIDENCE));
        vm.warp(4600);
        vm.expectRevert(MissionEscrow.InvalidTime.selector);
        escrow.settle(missionId, MissionEscrow.Outcome.Pass, EVIDENCE, signatures);
        escrow.rescue(missionId);
    }

    function testFinalizationCannotRepeat() public {
        _stake();
        _settle(MissionEscrow.Outcome.Pass);
        bytes[2] memory signatures = _sigs(escrow.verdictDigest(missionId, MissionEscrow.Outcome.Pass, EVIDENCE));
        vm.expectRevert(MissionEscrow.InvalidState.selector);
        escrow.settle(missionId, MissionEscrow.Outcome.Pass, EVIDENCE, signatures);
        vm.warp(4600);
        vm.expectRevert(MissionEscrow.InvalidState.selector);
        escrow.rescue(missionId);
    }
}
