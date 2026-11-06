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
  /** The frozen Bid set: first Bid per Worker, created in a block at or before `closesAt` (unix seconds, R2). */
  listBids(missionId: Hex, closesAt: number): Promise<SealedBid[]>;
  /** Decrypt this Verifier's copy of the price. Rejects if the Bid is malformed or priced above `maxBounty`. */
  openBid(bid: SealedBid, maxBounty: bigint): Promise<bigint>;
  /** Reliability from this Worker's Quorum Verdict history; only Verdicts written by `verifiers` (the Mission's on-chain Verifiers) count. */
  reliabilityOf(worker: Address, verifiers: readonly Address[]): Promise<number>;
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
  /** The Mission's 3 Verifiers: only their Verdicts count towards Reliability, and only they sign the Quorum. */
  verifiers: readonly Address[];
  /**
   * `Deadlines.biddingEndsAt`, unix seconds. `award()` reverts before it, and it is the Bid cutoff: the Requester writes the same value
   * to Arkiv as `biddingClosesAt` (agents/src/requester/requester.ts), so every Verifier freezes the same Bid set from the chain alone.
   */
  biddingEndsAt: number;
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
/**
 * A document the Worker uploaded whose bytes are not JSON. It is the Worker's fault (it committed to this root), so the checks
 * Fail it. JSON.parse never yields a class instance, so no uploaded content can pass itself off as one.
 */
export class NotJson {}

/**
 * A document the Worker registered on-chain but never uploaded: 0G Storage could not serve it and no 0G Flow submission for its
 * root exists between the Worker's stake and its Episode Submission. It is the Worker's fault, so the checks Fail it, like NotJson.
 */
export class NotUploaded {}

/** A Worker document as the Verifier fetched it: its content (not yet validated), or why there is none to read. */
export type Fetched<T> = T | NotJson | NotUploaded;

/** 0G Storage, by root hash. */
export interface StoragePort {
  /**
   * The parsed JSON stored under `root` (not validated: the Worker wrote it), or a `NotJson` when the bytes do not parse.
   * Rejects with `StorageUnavailableError` when 0G cannot be reached or times out, which is retryable and never a Verdict.
   */
  downloadJson(root: Hex): Promise<unknown>;
}

/** The 0G Flow contract on Galileo: every 0G Storage upload submits its root there before any byte reaches a storage node. */
export interface UploadRecordPort {
  /**
   * Whether a Flow submission for `root` was mined in a block stamped within [from, to] (unix seconds). Read from the chain alone, so
   * every Verifier gets the same answer. Rejects when the chain cannot be read or has no block after `to` yet.
   */
  submittedBetween(root: Hex, from: number, to: number): Promise<boolean>;
}

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
    /** As downloaded from 0G Storage: the checks validate both before trusting them. */
    policy: Fetched<Policy>;
    log: Fetched<EpisodeLog>;
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
