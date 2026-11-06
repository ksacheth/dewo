// ABIs for M2's contracts (chain/src on branch feat/12-onchain-contracts), written by hand from the
// Solidity until chain/deployments/*.json is published; then load { address, abi } from there instead.
import { parseAbi } from "viem";

export const missionEscrowAbi = parseAbi([
  "struct Deadlines { uint64 biddingEndsAt; uint32 stakeWindow; uint32 seedReleaseWindow; uint32 episodeWindow; uint64 rescueAt; }",
  "struct Mission { address requester; address worker; address[3] verifiers; bytes32 seedCommitment; uint256 maxBounty; uint8 difficultyClass; uint16 riskWeightBps; uint256 price; uint256 bidStake; uint256 awardedAt; uint256 stakedAt; Deadlines deadlines; uint8 state; }",
  "function asset() view returns (address)",
  "function createMission(bytes32 seedCommitment, address[3] verifiers, Deadlines deadlines, uint256 maxBounty, uint8 difficultyClass, uint16 riskWeightBps) payable returns (bytes32 missionId)",
  "function award(bytes32 missionId, address worker, uint256 price, uint256 bidStake, bytes[2] sigs)",
  "function stake(bytes32 missionId) payable",
  "function settle(bytes32 missionId, uint8 outcome, bytes32 evidenceHash, bytes[2] sigs)",
  "function rescue(bytes32 missionId)",
  "function withdraw()",
  "function owed(address account) view returns (uint256)",
  "function getMission(bytes32 missionId) view returns (Mission)",
  "function awardDigest(bytes32 missionId, address worker, uint256 price, uint256 bidStake) view returns (bytes32)",
  "function verdictDigest(bytes32 missionId, uint8 outcome, bytes32 evidenceHash) view returns (bytes32)",
  "event MissionCreated(bytes32 indexed missionId, address indexed requester, uint256 maxBounty, uint8 difficultyClass, uint16 riskWeightBps)",
  "event PayoutDeferred(bytes32 indexed missionId, address indexed recipient, uint256 amount)",
  "event Withdrawn(address indexed recipient, uint256 amount)",
]);

export const episodeRegistryAbi = parseAbi([
  "function submitEpisode(bytes32 missionId, bytes32 episodeLogRoot, bytes32 policyRoot, uint256 decisionCount)",
  "function submissions(bytes32 missionId, address worker) view returns (bytes32 episodeLogRoot, bytes32 policyRoot, uint256 decisionCount, uint256 submittedAt, bool exists)",
]);

export const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
]);

/** MissionEscrow difficultyClass: 0 easy, 1 medium, 2 hard. */
export const DIFFICULTY_CLASSES = ["easy", "medium", "hard"] as const;

/** MissionEscrow.State, in contract order. */
export const ESCROW_STATES = ["None", "Created", "Awarded", "Staked", "Settled", "Rescued"] as const;
