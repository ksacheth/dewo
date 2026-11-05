import type { Address, Hex } from "viem";
import type { Outcome } from "./sign.js";

/** Local view of the I4 `@dewo/board` surface the Verifier needs. Swapped for the real package at integration. */
export interface MissionRecord {
  missionId: Hex;
  riskWeight: number; // w in [0, 1]
  maxBounty: bigint; // USDC base units (6 decimals)
  seedCommitment: Hex;
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
