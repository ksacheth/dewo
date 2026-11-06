import type { Action, EpisodeLog, Policy } from "@dewo/agents/formats";
import type { Address, Hex } from "viem";
import type { Outcome } from "./sign.js";

export type Difficulty = "easy" | "medium" | "hard";

/** Local view of the I4 `@dewo/board` surface the Verifier needs. Swapped for the real package at integration. */
export interface MissionRecord {
  missionId: Hex;
  riskWeight: number; // w in [0, 1]
  maxBounty: bigint; // USDC base units (6 decimals)
  seedCommitment: Hex;
  difficultyClass: Difficulty;
}
export interface SealedBid { worker: Address; policyHash: Hex }
/** `pathQuality` (0..1) weights a Pass in Reliability; it is 0 for every other Outcome. */
export interface VerdictRecord { worker: Address; outcome: Outcome; pathQuality: number; timestamp: number }

export interface BoardPort {
  getMission(missionId: Hex): Promise<MissionRecord>;
  listBids(missionId: Hex): Promise<SealedBid[]>;
  /** Decrypt this Verifier's copy of the price ciphertext. Rejects if the Bid is malformed. */
  openBid(bid: SealedBid): Promise<bigint>;
  listVerdicts(worker: Address): Promise<VerdictRecord[]>;
}

/** I1 simulator surface (sim CLI). Mocked until M1 ships its stub or the dewo-sim image. */
export interface Course { seed: Hex; difficulty: Difficulty; [k: string]: unknown }
export interface ReplayResult {
  frameHashes: Hex[];
  collisions: number;
  atGoal: boolean;
  /** Decisions the sim executed; it stops at the goal. */
  steps: number;
}
export interface SimPort {
  course(seed: Hex, difficulty: Difficulty): Promise<Course>;
  /** `optimalPathCost`: the lowest count of non-STOP Actions to the goal (spec 4.6). Meaningless when not solvable. */
  plan(course: Course): Promise<{ solvable: boolean; optimalPathCost: number }>;
  replay(course: Course, actions: Action[]): Promise<ReplayResult>;
}

/** 0G Compute verification. processResponse(providerAddress, chatID) from the broker SDK. */
export interface ZeroGPort {
  verifyResponse(providerAddress: Address, chatID: string): Promise<boolean>;
}

/** What the Verifier learns about a Mission's Episode from Arkiv + 0G (episodes.ts implements this for real). */
export interface EpisodeSource {
  load(missionId: Hex): Promise<LoadedEpisode>;
}
export interface LoadedEpisode {
  mission: MissionRecord;
  /** The winning Worker of the Mission. */
  worker: Address;
  timeline: { stakedAt: number; seedReleasedAt?: number; episodeSubmittedAt?: number };
  /** Present once the Seed was released and an Episode Submission exists. */
  episode?: {
    bid: SealedBid;
    reveal: { seed: Hex; salt: Hex };
    policy: Policy;
    log: EpisodeLog;
    episodeLogRoot: Hex;
    decisionCount: number;
  };
}

export interface VerdictEntity {
  missionId: Hex; worker: Address; outcome: Outcome; pathCost: number; optimalPathCost: number; pathQuality: number; collisions: number;
  signature: Hex; evidenceHash: Hex; episodeLogRoot: Hex | null;
}
export interface VerdictSink { writeVerdict(v: VerdictEntity): Promise<void> }

/** I8 event feed. */
export interface EventSink { emit(missionId: Hex, type: string, data: Record<string, unknown>, txUrl?: string): Promise<void> }

/** 0G Galileo: EpisodeRegistry. Only submissions sent by `worker` count. `timestamp` is the block time of EpisodeSubmitted (No-show evidence). */
export interface EpisodeRegistryPort {
  findSubmission(missionId: Hex, worker: Address): Promise<{ episodeLogRoot: Hex; policyRoot: Hex; decisionCount: number; timestamp: number } | null>;
}
/** 0G Storage: download a JSON document by root hash. */
export interface StoragePort { downloadJson<T>(root: Hex): Promise<T> }
/** The current Award on Hedera. `stakedAt` is null until the winner stakes; it lapses once `awardedAt + stakeWindow` passes without a stake. */
export interface EscrowAward { worker: Address; awardedAt: number; stakeWindow: number; stakedAt: number | null }
export interface EscrowPort { getAward(missionId: Hex): Promise<EscrowAward | null> }
/** Arkiv seed facts. The revealed seed and salt become public after the Episode Submission. */
export interface SeedPort {
  seedReleasedAt(missionId: Hex, worker: Address): Promise<number | undefined>;
  revealedSeed(missionId: Hex): Promise<{ seed: Hex; salt: Hex } | null>;
}
