// Arkiv schemas plus the plain row/input types shared by the real library and the mock.
import { addr, bytes, dec, defineSchema, i32, str, u64, u256 } from "@arkiv-network/sdk/schema"
export type Hex = `0x${string}`
export type DifficultyClass = "easy" | "medium" | "hard"
export type MissionStatus = "open" | "awarded" | "settled"
export type Outcome = "Pass" | "Fail" | "NoShow" | "InvalidCourse" | "NoSeedRelease"

/** Fields every entity row carries from Arkiv. */
export type EntityMeta = { $key: Hex; $owner: Hex; $createdAt: number; $expiresAt: number }

export type MissionInput = {
  missionId: Hex // Escrow bytes32 (D2)
  difficultyClass: DifficultyClass
  bounty: bigint // USDC base units (D11)
  biddingClosesAt: number // unix seconds (D1)
  seedCommitment: string
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

export type SeedReleaseRow = EntityMeta & { missionId: Hex; worker: Hex; sealed: Uint8Array }

/** The Course Seed and salt in the clear, public after the Episode so anyone can re-run the Replay (D13). */
export type SeedRevealRow = EntityMeta & { missionId: Hex; seed: string; salt: string }

export type VerdictInput = {
  missionId: Hex
  worker: Hex
  outcome: Outcome
  pathCost: number // non-STOP Actions in the Replay (spec 4.6)
  optimalPathCost: number // the planner's lowest Path Cost on the revealed Course
  collisions: number
  difficultyClass: DifficultyClass // D3
  signature: string
  evidenceHash: string
  episodeLogRoot: string
}
/** pathQuality is derived from the two integers when the Verdict is written (see scoring.pathQuality); scoring never reads it back. */
export type VerdictRow = VerdictInput & EntityMeta & { pathQuality: number }

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
  seedCommitment: str(),
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

export const SeedRelease = defineSchema("dewo.seedRelease", {
  missionId: str().indexed(),
  worker: addr().indexed(),
  sealed: bytes(), // ECIES({seed, salt}) to the Worker's public key
})

export const SeedReveal = defineSchema("dewo.seedReveal", {
  missionId: str().indexed(),
  seed: str(),
  salt: str(),
})

export const Verdict = defineSchema("dewo.verdict", {
  missionId: str().indexed(),
  worker: addr().indexed(),
  outcome: str().indexed(),
  pathCost: i32().indexed(),
  collisions: i32().indexed(),
  difficultyClass: str().indexed(), // D3
  optimalPathCost: i32(),
  pathQuality: dec(), // optimalPathCost / pathCost, for display and queries; scoring recomputes it from the integers
  signature: bytes(), // 65-byte signature: same str limit
  evidenceHash: str(),
  episodeLogRoot: str(),
})

/** Entity lifetimes in milliseconds (D1 and board/PLAN.md section 3). Verdicts stay under the chain's ~182 day max. */
export const LIFETIME_MS = {
  mission: 60 * 60_000,
  bid: 60 * 60_000,
  seedRelease: 70 * 60_000,
  verdict: 180 * 24 * 60 * 60_000,
  seedReveal: 180 * 24 * 60 * 60_000,
} as const

const OUTCOMES: Outcome[] = ["Pass", "Fail", "NoShow", "InvalidCourse", "NoSeedRelease"]
/** Index in the I5 Outcome enum, for EIP-712 signing. */
export const outcomeIndex = (o: Outcome): number => OUTCOMES.indexOf(o)
