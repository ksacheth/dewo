import type { Action, EpisodeLog, Policy } from "@dewo/agents/formats";
import type { EventData, EventType } from "@dewo/board";
import type { Address, Hex } from "viem";
import type { Outcome } from "./sign.js";

export type Difficulty = "easy" | "medium" | "hard";

/** The Mission terms the Verifier scores against. Read from the on-chain Mission, never from Arkiv (spec 3, step 1). */
export interface MissionRecord {
  missionId: Hex;
  riskWeight: number; // w in [0, 1]
  maxBounty: bigint; // USDC base units (6 decimals)
  seedCommitment: Hex;
  difficultyClass: Difficulty;
  /** Per-Mission deadline windows in seconds, fixed at `createMission`; `settle()` enforces these, so the Verifier must too. */
  deadlines: { seedReleaseWindow: number; episodeWindow: number };
}

/** A sealed Bid as the board returns it. `ciphertext` is the board's own row, handed back to `openBid` untouched. */
export interface SealedBid { key: Hex; worker: Address; policyHash: Hex; ciphertext?: unknown }

/** Arkiv side of the Verifier: Bids, their sealed prices and Reliability (@dewo/board). */
export interface BoardPort {
  listBids(missionId: Hex): Promise<SealedBid[]>;
  /** Decrypt this Verifier's copy of the price. Rejects if the Bid is malformed or priced above `maxBounty`. */
  openBid(bid: SealedBid, maxBounty: bigint): Promise<bigint>;
  /** Reliability from the Quorum Verdict history of this Worker (board `reliability`). */
  reliabilityOf(worker: Address): Promise<number>;
}

/** I1 simulator surface (sim CLI). */
export interface Course { seed: Hex; difficulty: Difficulty; [k: string]: unknown }
export interface ReplayResult {
  /** One per Decision: sha256("dewo-frame-v1" + width + height + raw RGB) of the view before that Action. */
  frameHashes: Hex[];
  collisions: number;
  atGoal: boolean;
  /** Path Cost the sim executed: non-STOP Actions. It stops at the goal, a collision or STOP. */
  steps: number;
}
export interface SimPort {
  course(seed: Hex, difficulty: Difficulty): Promise<Course>;
  /** `optimalPathCost`: the lowest count of non-STOP Actions to the goal; -1 and not solvable when above 29. */
  plan(course: Course): Promise<{ solvable: boolean; optimalPathCost: number }>;
  replay(course: Course, actions: Action[]): Promise<ReplayResult>;
}

/** 0G Compute verification. processResponse(providerAddress, chatID) from the broker SDK. */
export interface ZeroGPort {
  verifyResponse(providerAddress: Address, chatID: string): Promise<boolean>;
}

/**
 * The current Award on Hedera. `stakedAt` is null until the winner stakes; it lapses once `awardedAt + stakeWindow` passes without a stake.
 * `price` and `stake` are the terms the Quorum signed, as the escrow stored them.
 */
export interface EscrowAward { worker: Address; price: bigint; stake: bigint; awardedAt: number; stakeWindow: number; stakedAt: number | null }
/** A Mission as MissionEscrow holds it. These terms are fixed at `createMission`, so the Requester cannot change them after Bids arrive. */
export interface EscrowMission {
  mission: MissionRecord;
  requester: Address;
  award: EscrowAward | null;
}
export interface EscrowPort {
  getMission(missionId: Hex): Promise<EscrowMission>;
  /** `lapsedWorker[missionId][worker]` on chain: an Award to this Worker was replaced because it missed the stake window. */
  isLapsed(missionId: Hex, worker: Address): Promise<boolean>;
}

/** Arkiv seed facts. The revealed seed and salt become public after the Episode Submission. */
export interface SeedPort {
  /** Unix seconds the Requester published the Seed Release for this Worker, or undefined if it did not. */
  seedReleasedAt(missionId: Hex, worker: Address, requester: Address): Promise<number | undefined>;
  revealedSeed(missionId: Hex, requester: Address): Promise<{ seed: Hex; salt: Hex } | null>;
}

/** 0G Galileo EpisodeRegistry. Only the winning Worker's own submission counts. `timestamp` is its block time (No-show evidence). */
export interface EpisodeRegistryPort {
  findSubmission(missionId: Hex, worker: Address): Promise<{ episodeLogRoot: Hex; policyRoot: Hex; decisionCount: number; timestamp: number } | null>;
}
/** 0G Storage: download a JSON document by root hash. */
export interface StoragePort { downloadJson<T>(root: Hex): Promise<T> }

/** What the Verifier learns about a Mission's Episode from Hedera, Arkiv and 0G (episodes.ts implements this). */
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

/** The Verdict entity written to Arkiv (board `VerdictInput`). */
export interface VerdictEntity {
  missionId: Hex; worker: Address; outcome: Outcome; difficultyClass: Difficulty;
  pathCost: number; optimalPathCost: number; collisions: number;
  signature: Hex; evidenceHash: Hex; episodeLogRoot: Hex;
}
export interface VerdictSink { writeVerdict(v: VerdictEntity): Promise<{ entityKey: Hex }> }

/** I8 event feed (board `EventData`). */
export interface EventSink {
  emit<T extends EventType>(missionId: Hex, type: T, data: EventData[T], txUrl?: string): Promise<void>;
}
