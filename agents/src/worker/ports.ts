// What the Worker needs from the outside world. Real adapters (Arkiv via @dewo/board,
// Hedera MissionEscrow, 0G Compute / Storage / EpisodeRegistry, the sim CLI) implement
// these once M1, M2 and M3 land; tests use in-memory fakes. Amounts are in USDC.
import type { Action, ChatReceipt, Hex } from "../formats";

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
}

/** The Mission terms fixed on-chain by createMission (ADR 0003). */
export interface MissionTerms {
  maxBounty: number;
  difficultyClass: DifficultyClass;
  riskWeightBps: number;
  seedCommitment: Hex;
  deadlines: MissionDeadlines;
}

export interface Award {
  worker: Hex;
  price: number;
  stake: number;
  awardedAt: number;
}

export interface EscrowMission {
  terms: MissionTerms;
  /** The current Award; it can move to the next-best Bid if the winner misses the stake window. */
  award: Award | null;
  stakedAt: number | null;
  settled: boolean;
}

export interface EscrowPort {
  getMission(missionId: string): Promise<EscrowMission>;
  stake(missionId: string, amount: number): Promise<void>;
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
  sealBid(price: number, verifierPubKeys: readonly Hex[]): Promise<readonly string[]>;
  placeBid(bid: BidEntity): Promise<void>;
  /** The Seed Release for this Worker, decrypted, or null if not released yet. */
  readSeedRelease(missionId: string): Promise<SeedRelease | null>;
}

export interface RegistryPort {
  submitEpisode(missionId: string, episodeLogRoot: Hex, policyRoot: Hex, decisionCount: number): Promise<void>;
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
  openSession(seed: Hex, difficulty: DifficultyClass): Promise<SimSession>;
}

export interface BalancesPort {
  wallet(): Promise<number>;
  zeroG(): Promise<number>;
}

export interface EventsPort {
  emit(missionId: string, type: string, data: Record<string, unknown>): void;
}

export interface Clock {
  now(): number;
}
