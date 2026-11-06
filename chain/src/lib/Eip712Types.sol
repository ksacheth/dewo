// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Frozen I5 types from PRD #10. See DESIGN.md for an optional round amendment (not implemented).
library Eip712Types {
    bytes32 internal constant AWARD_TYPEHASH =
        keccak256("Award(bytes32 missionId,address worker,uint256 price,uint256 stake)");
    bytes32 internal constant VERDICT_TYPEHASH =
        keccak256("Verdict(bytes32 missionId,uint8 outcome,bytes32 evidenceHash)");
}
