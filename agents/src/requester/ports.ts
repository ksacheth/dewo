// What the Requester needs from the outside world: the MissionEscrow writes (I5), its
// Arkiv entities (I4) and the Verifier HTTP API (I6, with x402 paid inside the adapter).
import type { Hex } from "../formats";
import type { WithdrawalPort } from "../shared/payout-claim";
import type { EscrowMission, MissionTerms, TxResult } from "../worker/ports";

/** I5 Outcome enum, in contract order. */
export const OUTCOMES = ["Pass", "Fail", "NoShow"] as const;
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

export interface RequesterEscrowPort extends WithdrawalPort {
  /** Locks maxBounty and fixes the terms on-chain; returns the Mission id and the transaction. */
  createMission(terms: MissionTerms, verifiers: readonly Hex[]): Promise<{ missionId: string } & TxResult>;
  getMission(missionId: string): Promise<EscrowMission>;
  /** The id of this Requester's Mission with that Course Seed (from MissionCreated events), or null. */
  findMission(courseSeed: Hex): Promise<string | null>;
  /** Refunds the Mission once rescueAt has passed; anyone may call it. */
  rescue(missionId: string): Promise<TxResult>;
  award(missionId: string, award: AwardTerms, signatures: readonly Hex[]): Promise<TxResult>;
  settle(missionId: string, outcome: Outcome, evidenceHash: Hex, signatures: readonly Hex[]): Promise<TxResult>;
}

/** The public Mission entity on Arkiv, for discovery. Verifiers and Workers trust the on-chain terms. */
export interface MissionListing {
  missionId: string;
  difficultyClass: MissionTerms["difficultyClass"];
  maxBounty: bigint;
  riskWeightBps: number;
  courseSeed: Hex;
  maxSteps: number;
  maxCollisions: number;
  biddingClosesAt: number;
}

export interface RequesterBoardPort {
  /** Returns the Arkiv entity key of the Mission. */
  postMission(listing: MissionListing): Promise<{ key: string }>;
  /** This Requester's own Mission entity for that id, if it already posted one (others' entities do not count). */
  listingOf(missionId: string): Promise<{ key: string } | null>;
}

/** What paying for one Replay looked like on the wire. */
export interface ReplayPayment {
  /** The Verifier answered 402 before it was paid. */
  challenged: boolean;
  /** USDC base units paid; 0 when the Replay was free. */
  amount: bigint;
  /** Who was paid, on which network and in which asset, as the x402 payment named them (absent if it was never paid). */
  payTo?: string;
  network?: string;
  asset?: string;
  /** The settlement transaction id from the PAYMENT-RESPONSE header, if the Verifier sent one. */
  paymentTx?: string;
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
