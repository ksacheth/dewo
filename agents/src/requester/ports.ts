// What the Requester needs from the outside world: the MissionEscrow writes (I5), its
// Arkiv entities (I4) and the Verifier HTTP API (I6, with x402 paid inside the adapter).
import type { Hex } from "../formats";
import type { EscrowMission, MissionTerms } from "../worker/ports";

/** I5 Outcome enum, in contract order. */
export const OUTCOMES = ["Pass", "Fail", "NoShow", "InvalidCourse", "NoSeedRelease"] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** Amounts in USDC base units, exactly as the Quorum signed them. */
export interface AwardTerms {
  worker: Hex;
  price: bigint;
  stake: bigint;
}

export interface SignedAward extends AwardTerms {
  signature: Hex;
}

export interface SignedVerdict {
  outcome: Outcome;
  evidenceHash: Hex;
  signature: Hex;
}

export interface RequesterEscrowPort {
  /** Locks maxBounty and fixes the terms on-chain; returns the Mission id. */
  createMission(terms: MissionTerms, verifiers: readonly Hex[]): Promise<string>;
  getMission(missionId: string): Promise<EscrowMission>;
  /** The id of this Requester's Mission with that Seed Commitment (from MissionCreated events), or null. */
  findMission(seedCommitment: Hex): Promise<string | null>;
  /** Refunds the Mission once rescueAt has passed; anyone may call it. */
  rescue(missionId: string): Promise<void>;
  award(missionId: string, award: AwardTerms, signatures: readonly Hex[]): Promise<void>;
  settle(missionId: string, outcome: Outcome, evidenceHash: Hex, signatures: readonly Hex[]): Promise<void>;
}

/** The public Mission entity on Arkiv, for discovery. Verifiers and Workers trust the on-chain terms. */
export interface MissionListing {
  missionId: string;
  difficultyClass: MissionTerms["difficultyClass"];
  maxBounty: bigint;
  riskWeightBps: number;
  seedCommitment: Hex;
  biddingClosesAt: number;
}

export interface RequesterBoardPort {
  /** Returns the Arkiv entity key of the Mission. */
  postMission(listing: MissionListing): Promise<{ key: string }>;
  /** The public key the winner put in its Bid entity. */
  workerPubKey(missionId: string, worker: Hex): Promise<Hex | null>;
  /** Whether a Seed Release for this winner is already on Arkiv. */
  hasSeedRelease(missionId: string, worker: Hex): Promise<boolean>;
  /** Seed + salt encrypted to the winner only. */
  releaseSeed(missionId: string, seed: Hex, salt: Hex, workerPubKey: Hex): Promise<{ key: string }>;
  /** Seed + salt in the clear, after the Episode, so anyone can re-run the Replay. */
  revealSeed(missionId: string, seed: Hex, salt: Hex): Promise<void>;
}

/** What paying for one Replay looked like on the wire. */
export interface ReplayPayment {
  /** The Verifier answered 402 before it was paid. */
  challenged: boolean;
  /** USDC base units paid; 0 when the Replay was free. */
  amount: bigint;
}

export interface ReplayResult {
  verdict: SignedVerdict;
  payment: ReplayPayment;
}

export interface VerifiersPort {
  /** POST /award (free). Null when there is no valid Bid to award. */
  requestAward(verifierUrl: string, missionId: string): Promise<SignedAward | null>;
  /** POST /replay, paying the 402 through x402. The adapter enforces the per-Replay price cap. */
  requestReplay(verifierUrl: string, missionId: string): Promise<ReplayResult>;
}
