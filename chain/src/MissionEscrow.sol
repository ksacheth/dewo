// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IHederaTokenService} from "./interfaces/IHederaTokenService.sol";
import {Eip712Types} from "./lib/Eip712Types.sol";

/// @notice Quorum-authorized Escrow. A lapsed Award (no stake in the stake window) can be replaced.
contract MissionEscrow is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Outcome {
        Pass,
        Fail,
        NoShow,
        InvalidCourse,
        NoSeedRelease
    }
    enum State {
        None,
        Created,
        Awarded,
        Staked,
        Settled,
        Rescued
    }

    struct Deadlines {
        uint64 biddingEndsAt;
        uint32 stakeWindow;
        uint32 seedReleaseWindow;
        uint32 episodeWindow;
        uint64 rescueAt;
    }

    struct Mission {
        address requester;
        address worker;
        address[3] verifiers;
        bytes32 seedCommitment;
        uint256 maxBounty;
        uint256 price;
        uint256 bidStake;
        uint256 awardedAt;
        uint256 stakedAt;
        Deadlines deadlines;
        State state;
    }

    address public immutable asset;
    uint256 private nonce;
    mapping(bytes32 => Mission) private missions;
    /// @dev Workers whose Award lapsed; blocks replaying their old Award signatures.
    mapping(bytes32 => mapping(address => bool)) public lapsedWorker;

    error InvalidConfiguration();
    error InvalidState();
    error InvalidTime();
    error InvalidAmount();
    error InvalidQuorum();
    error NotWorker();
    error AssociationFailed(int64 responseCode);
    error NativeTransferFailed();

    event MissionCreated(bytes32 indexed missionId, address indexed requester, uint256 maxBounty);
    event Awarded(bytes32 indexed missionId, address indexed worker, uint256 price, uint256 stake);
    event Staked(bytes32 indexed missionId, address indexed worker, uint256 amount);
    event Settled(bytes32 indexed missionId, Outcome outcome, bytes32 evidenceHash);
    event Rescued(bytes32 indexed missionId);

    /// @param settlementAsset HTS token address, or zero for a separate HBAR fallback deployment.
    constructor(address settlementAsset) EIP712("Dewo", "1") {
        asset = settlementAsset;
        if (settlementAsset != address(0)) {
            int64 response = IHederaTokenService(address(0x167)).associateToken(address(this), settlementAsset);
            if (response != 22) revert AssociationFailed(response);
        }
    }

    function createMission(
        bytes32 seedCommitment,
        address[3] calldata verifiers,
        Deadlines calldata deadlines,
        uint256 maxBounty
    ) external payable nonReentrant returns (bytes32 missionId) {
        if (seedCommitment == bytes32(0) || maxBounty == 0) revert InvalidConfiguration();
        for (uint256 i; i < 3; ++i) {
            if (verifiers[i] == address(0)) revert InvalidConfiguration();
            for (uint256 j; j < i; ++j) {
                if (verifiers[i] == verifiers[j]) revert InvalidConfiguration();
            }
        }
        uint256 duration = uint256(deadlines.stakeWindow) + deadlines.seedReleaseWindow + deadlines.episodeWindow;
        if (
            deadlines.biddingEndsAt <= block.timestamp || deadlines.stakeWindow == 0 || deadlines.seedReleaseWindow == 0
                || deadlines.episodeWindow == 0 || uint256(deadlines.biddingEndsAt) + duration >= deadlines.rescueAt
        ) revert InvalidTime();

        missionId = keccak256(abi.encode(block.chainid, address(this), msg.sender, nonce++));
        Mission storage mission = missions[missionId];
        mission.requester = msg.sender;
        mission.verifiers = verifiers;
        mission.seedCommitment = seedCommitment;
        mission.maxBounty = maxBounty;
        mission.deadlines = deadlines;
        mission.state = State.Created;
        _collect(maxBounty);
        emit MissionCreated(missionId, msg.sender, maxBounty);
    }

    function award(bytes32 missionId, address worker, uint256 price, uint256 bidStake, bytes[2] calldata sigs)
        external
        nonReentrant
    {
        Mission storage mission = missions[missionId];
        if (mission.state == State.Awarded) {
            // Replacement Award: only once the current winner missed the stake window.
            if (block.timestamp <= mission.awardedAt + mission.deadlines.stakeWindow) revert InvalidTime();
            lapsedWorker[missionId][mission.worker] = true;
        } else if (mission.state != State.Created) {
            revert InvalidState();
        }
        uint256 duration = uint256(mission.deadlines.stakeWindow) + mission.deadlines.seedReleaseWindow
            + mission.deadlines.episodeWindow;
        if (
            block.timestamp < mission.deadlines.biddingEndsAt
                || block.timestamp + duration >= mission.deadlines.rescueAt
        ) revert InvalidTime();
        if (worker == address(0) || worker == address(this) || lapsedWorker[missionId][worker]) {
            revert InvalidConfiguration();
        }
        // Reliability is computed off-chain; only enforce its possible stake range.
        if (price == 0 || price > mission.maxBounty || bidStake > mission.maxBounty / 2) revert InvalidAmount();
        _checkQuorum(mission, awardDigest(missionId, worker, price, bidStake), sigs);
        mission.worker = worker;
        mission.price = price;
        mission.bidStake = bidStake;
        mission.awardedAt = block.timestamp;
        mission.state = State.Awarded;
        emit Awarded(missionId, worker, price, bidStake);
    }

    function stake(bytes32 missionId) external payable nonReentrant {
        Mission storage mission = missions[missionId];
        if (mission.state != State.Awarded) revert InvalidState();
        if (msg.sender != mission.worker) revert NotWorker();
        if (block.timestamp >= mission.awardedAt + mission.deadlines.stakeWindow) revert InvalidTime();
        mission.state = State.Staked;
        mission.stakedAt = block.timestamp;
        _collect(mission.bidStake);
        emit Staked(missionId, msg.sender, mission.bidStake);
    }

    function settle(bytes32 missionId, Outcome outcome, bytes32 evidenceHash, bytes[2] calldata sigs)
        external
        nonReentrant
    {
        Mission storage mission = missions[missionId];
        if (mission.state != State.Staked) revert InvalidState();
        if (block.timestamp >= mission.deadlines.rescueAt) revert InvalidTime();
        if (
            outcome == Outcome.NoSeedRelease && block.timestamp < mission.stakedAt + mission.deadlines.seedReleaseWindow
        ) revert InvalidTime();
        _checkQuorum(mission, verdictDigest(missionId, outcome, evidenceHash), sigs);
        mission.state = State.Settled;
        bool payWorker = outcome == Outcome.Pass || outcome == Outcome.InvalidCourse || outcome == Outcome.NoSeedRelease;
        uint256 workerAmount = payWorker ? mission.price + mission.bidStake : 0;
        uint256 requesterAmount = mission.maxBounty + mission.bidStake - workerAmount;
        _pay(mission.worker, workerAmount);
        _pay(mission.requester, requesterAmount);
        emit Settled(missionId, outcome, evidenceHash);
    }

    function rescue(bytes32 missionId) external nonReentrant {
        Mission storage mission = missions[missionId];
        State previous = mission.state;
        if (previous != State.Created && previous != State.Awarded && previous != State.Staked) revert InvalidState();
        if (block.timestamp < mission.deadlines.rescueAt) revert InvalidTime();
        mission.state = State.Rescued;
        if (previous == State.Staked) _pay(mission.worker, mission.bidStake);
        _pay(mission.requester, mission.maxBounty);
        emit Rescued(missionId);
    }

    function getMission(bytes32 missionId) external view returns (Mission memory) {
        return missions[missionId];
    }

    function awardDigest(bytes32 missionId, address worker, uint256 price, uint256 bidStake)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(Eip712Types.AWARD_TYPEHASH, missionId, worker, price, bidStake)));
    }

    function verdictDigest(bytes32 missionId, Outcome outcome, bytes32 evidenceHash) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(Eip712Types.VERDICT_TYPEHASH, missionId, outcome, evidenceHash)));
    }

    function _checkQuorum(Mission storage mission, bytes32 digest, bytes[2] calldata sigs) private view {
        address first = ECDSA.recover(digest, sigs[0]);
        address second = ECDSA.recover(digest, sigs[1]);
        if (first == second || !_isVerifier(mission, first) || !_isVerifier(mission, second)) revert InvalidQuorum();
    }

    function _isVerifier(Mission storage mission, address signer) private view returns (bool) {
        return signer == mission.verifiers[0] || signer == mission.verifiers[1] || signer == mission.verifiers[2];
    }

    function _collect(uint256 amount) private {
        if (asset == address(0)) {
            if (msg.value != amount) revert InvalidAmount();
        } else {
            if (msg.value != 0) revert InvalidAmount();
            if (amount == 0) return;
            uint256 beforeBalance = IERC20(asset).balanceOf(address(this));
            IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
            if (IERC20(asset).balanceOf(address(this)) - beforeBalance != amount) revert InvalidAmount();
        }
    }

    function _pay(address recipient, uint256 amount) private {
        if (amount == 0) return;
        if (asset == address(0)) {
            (bool sent,) = payable(recipient).call{value: amount}("");
            if (!sent) revert NativeTransferFailed();
        } else {
            IERC20(asset).safeTransfer(recipient, amount);
        }
    }
}
