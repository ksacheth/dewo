// Plain row/input types shared by the real library and the mock. defineSchema calls land in B4.
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
  stepBudget: number
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
export type BidRow = BidInput & EntityMeta & { worker: Hex }

export type SeedReleaseRow = EntityMeta & { missionId: Hex; worker: Hex; sealed: Uint8Array }

export type VerdictInput = {
  missionId: Hex
  worker: Hex
  outcome: Outcome
  steps: number
  collisions: number
  difficultyClass: DifficultyClass // D3
  stepBudget: number // D3
  signature: string
  evidenceHash: string
  episodeLogRoot: string
}
export type VerdictRow = VerdictInput & EntityMeta
