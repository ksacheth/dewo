import type { Address, Hex } from "viem";
import type { Outcome } from "./sign.js";

export type Difficulty = "easy" | "medium" | "hard";

/** Local view of the I4 `@dewo/board` surface the Verifier needs. Swapped for the real package at integration. */
export interface MissionRecord {
  missionId: Hex;
  riskWeight: number; // w in [0, 1]
  maxBounty: bigint; // USDC base units (6 decimals)
  seedCommitment: Hex;
  stepBudget: number;
  difficultyClass: Difficulty;
}
export interface SealedBid { worker: Address; policyHash: Hex }
export interface VerdictRecord { worker: Address; outcome: Outcome; timestamp: number }

export interface BoardPort {
  getMission(missionId: Hex): Promise<MissionRecord>;
  listBids(missionId: Hex): Promise<SealedBid[]>;
  /** Decrypt this Verifier's copy of the price ciphertext. Rejects if the Bid is malformed. */
  openBid(bid: SealedBid): Promise<bigint>;
  listVerdicts(worker: Address): Promise<VerdictRecord[]>;
}

/** I1 simulator surface (sim CLI). Mocked until M1 ships its stub or the dewo-sim image. */
export type Action = "FORWARD" | "TURN_LEFT" | "TURN_RIGHT" | "STOP";
export interface Course { seed: Hex; difficulty: Difficulty; [k: string]: unknown }
export interface ReplayResult {
  frameHashes: Hex[];
  collisions: number;
  atGoal: boolean;
  steps: number;
  /** Frame payloads (e.g. data URLs) for the request-rebuild check. Not in I1 today; see open question for M1. */
  frames?: string[];
}
export interface SimPort {
  course(seed: Hex, difficulty: Difficulty): Promise<Course>;
  plan(course: Course, stepBudget: number): Promise<{ solvable: boolean; minSteps: number }>;
  replay(course: Course, actions: Action[]): Promise<ReplayResult>;
}

/** 0G Compute verification. processResponse(providerAddress, chatID) from the broker SDK. */
export interface ZeroGPort {
  verifyResponse(providerAddress: Address, chatID: string): Promise<boolean>;
}
