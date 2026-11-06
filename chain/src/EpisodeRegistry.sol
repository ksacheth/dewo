// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Immutable first submission per Mission and Worker. Verifiers select the awarded Worker.
contract EpisodeRegistry {
    struct Submission {
        bytes32 episodeLogRoot;
        bytes32 policyRoot;
        uint256 decisionCount;
        uint256 submittedAt;
        bool exists;
    }

    mapping(bytes32 => mapping(address => Submission)) public submissions;

    error InvalidSubmission();
    error AlreadySubmitted();

    event EpisodeSubmitted(
        bytes32 indexed missionId,
        address indexed worker,
        bytes32 episodeLogRoot,
        bytes32 policyRoot,
        uint256 decisionCount
    );

    function submitEpisode(bytes32 missionId, bytes32 episodeLogRoot, bytes32 policyRoot, uint256 decisionCount)
        external
    {
        if (missionId == bytes32(0) || episodeLogRoot == bytes32(0) || policyRoot == bytes32(0)) {
            revert InvalidSubmission();
        }
        if (submissions[missionId][msg.sender].exists) revert AlreadySubmitted();
        // Zero Decisions is valid for an immediate safe-stop; the Verifier decides its Outcome.
        submissions[missionId][msg.sender] =
            Submission(episodeLogRoot, policyRoot, decisionCount, block.timestamp, true);
        emit EpisodeSubmitted(missionId, msg.sender, episodeLogRoot, policyRoot, decisionCount);
    }
}
