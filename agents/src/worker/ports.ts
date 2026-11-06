// What the Worker needs from the outside world. Real adapters (Arkiv via @dewo/board,
// Hedera MissionEscrow, 0G Compute / Storage / EpisodeRegistry, the sim CLI) implement
// these once M1, M2 and M3 land; tests use in-memory fakes. Money is USDC base units (bigint).
import type { Action, ChatReceipt, Hex } from "../formats";
import type { EventData, EventType } from "../shared/events";
import type { WithdrawalPort } from "../shared/payout-claim";

export type DifficultyClass = "easy" | "medium" | "hard";

/** Seconds since the Unix epoch for instants; seconds for windows. */
export interface MissionDeadlines {
  biddingClosesAt: number;
  /** After the Award. */
  stakeWindow: number;
  /** After the stake. */
  seedReleaseWindow: number;
  /** After the Seed Release. */
  episodeWindow: number;
  /** Absolute; after it only rescue() can close the Mission. */
  rescueAt: number;
}

/** The Mission terms fixed on-chain by createMission (ADR 0003). */
export interface MissionTerms {
  maxBounty: bigint;
  difficultyClass: DifficultyClass;
  riskWeightBps: number;
  seedCommitment: Hex;
  deadlines: MissionDeadlines;
}

export interface Award {
  worker: Hex;
  price: bigint;
  stake: bigint;
  awardedAt: number;
}

export interface EscrowMission {
  terms: MissionTerms;
  /** The current Award; it can move to the next-best Bid if the winner misses the stake window. */
  award: Award | null;
  stakedAt: number | null;
  settled: boolean;
}

/** Every on-chain write reports its transaction hash, so events can link to the explorer. */
export interface TxResult {
  txHash: Hex;
}

export interface EscrowPort extends WithdrawalPort {
  getMission(missionId: string): Promise<EscrowMission>;
  stake(missionId: string, amount: bigint): Promise<TxResult>;
}

export interface SeedRelease {
  seed: Hex;
  salt: Hex;
  releasedAt: number;
}

export interface BidEntity {
  missionId: string;
  worker: Hex;
  policyHash: Hex;
  workerPubKey: Hex;
  /** The price encrypted to each of the 3 Verifier keys. */
  sealedPrice: readonly string[];
}

export interface BoardPort {
  listOpenMissionIds(): Promise<string[]>;
  reliabilityOf(worker: Hex): Promise<number>;
  sealBid(price: bigint, verifierPubKeys: readonly Hex[]): Promise<readonly string[]>;
  /** Returns the Arkiv entity key of the Bid. */
  placeBid(bid: BidEntity): Promise<{ key: string }>;
  /** This Worker's existing Bid on the Mission, or null. The protocol allows one Bid per Worker per Mission. */
  myBid(missionId: string, worker: Hex): Promise<{ key: string } | null>;
  /** The Seed Release for this Worker, decrypted, or null if not released yet. */
  readSeedRelease(missionId: string): Promise<SeedRelease | null>;
}

export interface RegistryPort {
  submitEpisode(missionId: string, episodeLogRoot: Hex, policyRoot: Hex, decisionCount: number): Promise<TxResult>;
  isSubmitted(missionId: string, worker: Hex): Promise<boolean>;
}

export interface StoragePort {
  /** Uploads to 0G Storage and returns the root hash. */
  upload(bytes: Uint8Array): Promise<Hex>;
}

export interface InferenceReply {
  chatID: string;
  rawResponse: string;
  receipt?: ChatReceipt;
}

export interface InferencePort {
  complete(providerAddress: Hex, request: unknown): Promise<InferenceReply>;
}

export interface Observation {
  frame: Uint8Array;
  frameHash: Hex;
  /** Where the frame file lives, relative to the runs/ folder (e.g. <missionId>/frames/frame_0000.png). */
  framePath: string;
}

export interface ActResult {
  collision: boolean;
  atGoal: boolean;
}

export interface SimSession {
  observe(): Promise<Observation>;
  act(action: Action): Promise<ActResult>;
  close(): Promise<void>;
}

export interface SimPort {
  /** Frames are written under runs/<missionId>/frames/ so the web can serve them. */
  openSession(seed: Hex, difficulty: DifficultyClass, missionId: string): Promise<SimSession>;
}

export interface BalancesPort {
  /** USDC base units. */
  wallet(): Promise<bigint>;
  /** 0G Compute ledger balance, in the same unit as the strategy's zeroGPerDecision. */
  zeroG(): Promise<number>;
}

export interface EventsPort {
  /** Typed by event type, so a payload that drifts from the I8 schema does not compile. */
  emit<T extends EventType>(missionId: string, type: T, data: EventData[T], txUrl?: string): void;
}

export interface Clock {
  now(): number;
}
