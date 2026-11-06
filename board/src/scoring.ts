// Pure scoring functions from docs/spec.md section 4.
import type { Hex, Outcome, VerdictRow } from "./schemas"

const ALPHA = 2
const BETA = 1
const LAMBDA = 0.9
const MULTIPLIER = { easy: 1, medium: 1.5, hard: 2 } as const

/** Path Quality q = min(1, optimal / cost); 0 when the path cost is 0 (spec 4.6). */
export function pathQuality(optimalPathCost: number, pathCost: number): number {
  if (pathCost <= 0) return 0
  return Math.min(1, Math.max(0, optimalPathCost) / pathCost)
}

/** Computed from the integers, never from the stored float. */
const qualityOf = (v: VerdictRow) => pathQuality(v.optimalPathCost, v.pathCost)

export type MissionResult = { missionId: Hex; outcome: Outcome; at: number; verdict: VerdictRow }

/**
 * One result per Mission: the Outcome at least 2 of the 3 Verifiers agree on (D4).
 * Only Verdicts owned by one of `verifiers` count (addresses compare case-insensitively), and each Verifier
 * counts once per Mission, by its earliest Verdict ($createdAt, then $key). Arkiv is public, so anyone can
 * write rows; this stops duplicates or outsiders from forming a fake Quorum. Missions without a Quorum are dropped.
 */
export function quorumResults(verdicts: VerdictRow[], verifiers: readonly Hex[]): MissionResult[] {
  const allowed = new Set(verifiers.map((a) => a.toLowerCase()))
  const earliest = new Map<string, VerdictRow>() // missionId + owner -> that Verifier's Verdict
  for (const v of verdicts) {
    const owner = v.$owner.toLowerCase()
    if (!allowed.has(owner)) continue
    const k = `${v.missionId}:${owner}`
    const prev = earliest.get(k)
    if (!prev || v.$createdAt < prev.$createdAt || (v.$createdAt === prev.$createdAt && v.$key < prev.$key)) earliest.set(k, v)
  }
  const byMission = new Map<Hex, VerdictRow[]>()
  for (const v of earliest.values()) byMission.set(v.missionId, [...(byMission.get(v.missionId) ?? []), v])
  const results: MissionResult[] = []
  for (const [missionId, vs] of byMission) {
    const counts = new Map<Outcome, number>()
    for (const v of vs) counts.set(v.outcome, (counts.get(v.outcome) ?? 0) + 1)
    const agreed = [...counts].find(([, n]) => n >= 2)?.[0]
    if (!agreed) continue
    const matching = vs.filter((v) => v.outcome === agreed).sort((x, y) => x.$createdAt - y.$createdAt || (x.$key < y.$key ? -1 : 1))
    results.push({ missionId, outcome: agreed, at: Math.max(...matching.map((v) => v.$createdAt)), verdict: matching[0] })
  }
  return results.sort((a, b) => b.at - a.at)
}

/** R = (2 + sum 0.9^i pass_i) / (3 + sum 0.9^i), most recent Mission first. A Pass counts 0.5 + 0.5 q; Fail and NoShow count 0. */
export function reliability(verdicts: VerdictRow[], verifiers: readonly Hex[]): number {
  const counted = quorumResults(verdicts, verifiers).filter((r) => r.outcome !== "InvalidCourse" && r.outcome !== "NoSeedRelease")
  let passes = 0
  let weights = 0
  counted.forEach((r, i) => {
    const w = LAMBDA ** i
    weights += w
    if (r.outcome === "Pass") passes += w * (0.5 + 0.5 * qualityOf(r.verdict))
  })
  return (ALPHA + passes) / (ALPHA + BETA + weights)
}

/** S = R^w / price^(1-w). */
export function awardScore(R: number, price: number, riskWeight: number): number {
  return R ** riskWeight / price ** (1 - riskWeight)
}

/** Highest S wins; ties go to the lower price, then the lower Bid key (D8). All Verifiers must pick the same winner. Bids with a price <= 0 are ignored. */
export function pickWinner<B extends { key: string; price: bigint; R: number }>(bids: B[], riskWeight: number): B {
  const valid = bids.filter((b) => b.price > 0n)
  if (valid.length === 0) throw new Error("pickWinner: no bids")
  const score = (b: B) => awardScore(b.R, Number(b.price), riskWeight)
  return valid.sort(
    (a, b) => score(b) - score(a) || (a.price < b.price ? -1 : a.price > b.price ? 1 : 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  )[0]
}

/** floor(maxBounty * (1 - R) * 0.5) in integer USDC base units (D11); (1 - R) is fixed-point with 1e6 precision. */
export function bidStake(maxBounty: bigint, R: number): bigint {
  const f = BigInt(Math.round((1 - Math.min(1, Math.max(0, R))) * 1e6))
  return (maxBounty * f) / 2_000_000n
}

/** XP for one Verdict: Pass only. 100 * m * (1 + q). */
export function xp(v: VerdictRow): number {
  if (v.outcome !== "Pass") return 0
  return 100 * MULTIPLIER[v.difficultyClass] * (1 + qualityOf(v))
}

/** Total XP over Missions that reached a Quorum, each counted once. */
export function totalXp(verdicts: VerdictRow[], verifiers: readonly Hex[]): number {
  return quorumResults(verdicts, verifiers).reduce((sum, r) => sum + xp(r.verdict), 0)
}

export function level(totalXpPoints: number): number {
  return Math.floor(Math.sqrt(totalXpPoints / 100))
}
