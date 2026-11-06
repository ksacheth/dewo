// Arkiv schemas plus the plain row/input types shared by the real library and the mock.
import { addr, bytes, dec, defineSchema, i32, str, u64, u256 } from "@arkiv-network/sdk/schema"
export type Hex = `0x${string}`
export type DifficultyClass = "easy" | "medium" | "hard"
export type MissionStatus = "open" | "awarded" | "settled"
export type Outcome = "Pass" | "Fail" | "NoShow"

/** Fields every entity row carries from Arkiv. */
export type EntityMeta = { $key: Hex; $owner: Hex; $createdAt: number; $expiresAt: number }

export type MissionInput = {
  missionId: Hex // Escrow bytes32 (D2)
  difficultyClass: DifficultyClass
  bounty: bigint // USDC base units (D11)
  biddingClosesAt: number // unix seconds (D1)
  courseSeed: Hex // public Course Seed, the same bytes32 as in the escrow (ADR 0006)
  maxSteps: number // the Requester's limits, the same as in the escrow (#66)
  maxCollisions: number
  riskWeight: number
  verifiers: string // comma-joined addresses (D7)
}
export type MissionRow = MissionInput & EntityMeta & { status: MissionStatus; requester: Hex; escrowMissionId: string }

export type BidInput = {
  missionId: Hex
  policyHash: string
  workerPubKey: Hex
  verifiers: string
  priceCt0: Uint8Array
  priceCt1: Uint8Array
  priceCt2: Uint8Array
}
/** `createdAtSec` is the unix-seconds timestamp of the block that created the Bid (R2); listBids fills it. */
export type BidRow = BidInput & EntityMeta & { worker: Hex; createdAtSec: number }

export type VerdictInput = {
  missionId: Hex
  worker: Hex
  outcome: Outcome
  steps: number // non-STOP Actions in the Replay (spec 4.6)
  collisions: number
  difficultyClass: DifficultyClass // D3
  signature: string
  evidenceHash: string
  episodeLogRoot: string
}
export type VerdictRow = VerdictInput & EntityMeta

// ---- Arkiv schemas (docs/spec.md 5.3, board/DECISIONS.md) ----

/** Anything with an address can write: a viem wallet client, a local account holder, or the mock's stand-in. */
export type WalletLike = { account: { address: Hex } }

export const Mission = defineSchema("dewo.mission", {
  missionId: str().indexed(), // D2: Escrow bytes32
  difficultyClass: str().indexed(),
  bounty: u256().indexed(),
  status: str().indexed(),
  requester: addr().indexed(),
  biddingClosesAt: u64().indexed(), // D1
  courseSeed: str(), // public before bidding: Workers study the Course and price from it (ADR 0006)
  maxSteps: u64(),
  maxCollisions: u64(),
  riskWeight: dec(),
  escrowMissionId: str(),
  verifiers: str(), // comma-joined, D7
})

export const Bid = defineSchema("dewo.bid", {
  missionId: str().indexed(),
  worker: addr().indexed(),
  policyHash: str(),
  workerPubKey: bytes(), // 65-byte key is 132 hex chars: over the 128-byte str limit
  verifiers: str(), // D7: order of priceCt0..2
  priceCt0: bytes(),
  priceCt1: bytes(),
  priceCt2: bytes(),
})

export const Verdict = defineSchema("dewo.verdict", {
  missionId: str().indexed(),
  worker: addr().indexed(),
  outcome: str().indexed(),
  steps: i32().indexed(),
  collisions: i32().indexed(),
  difficultyClass: str().indexed(), // D3
  signature: bytes(), // 65-byte signature: same str limit
  evidenceHash: str(),
  episodeLogRoot: str(),
})

/** Entity lifetimes in milliseconds (D1 and board/PLAN.md section 3). Verdicts stay under the chain's ~182 day max. */
export const LIFETIME_MS = {
  mission: 60 * 60_000,
  bid: 60 * 60_000,
  verdict: 180 * 24 * 60 * 60_000,
} as const

const OUTCOMES: Outcome[] = ["Pass", "Fail", "NoShow"]
/** Index in the I5 Outcome enum, for EIP-712 signing. */
export const outcomeIndex = (o: Outcome): number => OUTCOMES.indexOf(o)
