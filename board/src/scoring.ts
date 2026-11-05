// Pure scoring functions from docs/spec.md section 4.
import type { Hex, Outcome, VerdictRow } from "./schemas"

const ALPHA = 2
const BETA = 1
const LAMBDA = 0.9
const MULTIPLIER = { easy: 1, medium: 1.5, hard: 2 } as const

export type MissionResult = { missionId: Hex; outcome: Outcome; at: number; verdict: VerdictRow }

/** One result per Mission: the Outcome at least 2 of the 3 Verifiers agree on (D4). Missions without a Quorum are dropped. */
export function quorumResults(verdicts: VerdictRow[]): MissionResult[] {
  const byMission = new Map<Hex, VerdictRow[]>()
  for (const v of verdicts) byMission.set(v.missionId, [...(byMission.get(v.missionId) ?? []), v])
  const results: MissionResult[] = []
  for (const [missionId, vs] of byMission) {
    const counts = new Map<Outcome, number>()
    for (const v of vs) counts.set(v.outcome, (counts.get(v.outcome) ?? 0) + 1)
    const agreed = [...counts].find(([, n]) => n >= 2)?.[0]
    if (!agreed) continue
    const matching = vs.filter((v) => v.outcome === agreed)
    results.push({ missionId, outcome: agreed, at: Math.max(...matching.map((v) => v.$createdAt)), verdict: matching[0] })
  }
  return results.sort((a, b) => b.at - a.at)
}

/** R = (2 + sum 0.9^i pass_i) / (3 + sum 0.9^i), most recent Mission first. */
export function reliability(verdicts: VerdictRow[]): number {
  const counted = quorumResults(verdicts).filter((r) => r.outcome !== "InvalidCourse" && r.outcome !== "NoSeedRelease")
  let passes = 0
  let weights = 0
  counted.forEach((r, i) => {
    const w = LAMBDA ** i
    weights += w
    if (r.outcome === "Pass") passes += w
  })
  return (ALPHA + passes) / (ALPHA + BETA + weights)
}

/** S = R^w / price^(1-w). */
export function awardScore(R: number, price: number, riskWeight: number): number {
  return R ** riskWeight / price ** (1 - riskWeight)
}

/** Highest S wins; ties go to the lower price, then the lower Bid key (D8). All Verifiers must pick the same winner. */
export function pickWinner<B extends { key: string; price: bigint; R: number }>(bids: B[], riskWeight: number): B {
  if (bids.length === 0) throw new Error("pickWinner: no bids")
  const score = (b: B) => awardScore(b.R, Number(b.price), riskWeight)
  return [...bids].sort(
    (a, b) => score(b) - score(a) || (a.price < b.price ? -1 : a.price > b.price ? 1 : 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  )[0]
}

/** floor(maxBounty * (1 - R) * 0.5) in integer USDC base units (D11); (1 - R) is fixed-point with 1e6 precision. */
export function bidStake(maxBounty: bigint, R: number): bigint {
  const f = BigInt(Math.round((1 - Math.min(1, Math.max(0, R))) * 1e6))
  return (maxBounty * f) / 2_000_000n
}

/** XP for one Verdict: Pass only. 100 * m * (1 + unusedSteps / stepBudget). */
export function xp(v: VerdictRow): number {
  if (v.outcome !== "Pass") return 0
  const unused = Math.max(0, v.stepBudget - v.steps)
  return 100 * MULTIPLIER[v.difficultyClass] * (1 + unused / v.stepBudget)
}

/** Total XP over Missions that reached a Quorum, each counted once. */
export function totalXp(verdicts: VerdictRow[]): number {
  return quorumResults(verdicts).reduce((sum, r) => sum + xp(r.verdict), 0)
}

export function level(totalXpPoints: number): number {
  return Math.floor(Math.sqrt(totalXpPoints / 100))
}
