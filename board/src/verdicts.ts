import { level, quorumResults, reliability, totalXp } from "./scoring"
import type { DifficultyClass, Hex, Outcome, VerdictRow } from "./schemas"

/** D5: Verdicts count only when written by one of these Verifier addresses (VERIFIER_ADDRESSES, comma-separated). */
export function trustedVerifiers(): Hex[] {
  const list = (process.env.VERIFIER_ADDRESSES ?? "").split(",").map((a) => a.trim()).filter(Boolean)
  if (list.length === 0) throw new Error("VERIFIER_ADDRESSES is not set")
  return list as Hex[]
}

export type VerdictFilter = { worker?: Hex; missionId?: Hex; outcome?: Outcome }

export type LeaderboardRow = {
  worker: Hex
  reliability: number
  xp: number
  level: number
  missions: { missionId: Hex; outcome: Outcome; steps: number; collisions: number; difficultyClass: DifficultyClass; entityKey: Hex }[]
}

/** Groups trusted Verdicts per Worker; sorted by Level, then XP. Shared by the web UI, the query script and the mock. */
export function leaderboardFrom(verdicts: VerdictRow[]): LeaderboardRow[] {
  const byWorker = new Map<Hex, VerdictRow[]>()
  for (const v of verdicts) byWorker.set(v.worker, [...(byWorker.get(v.worker) ?? []), v])
  return [...byWorker].map(([worker, vs]) => {
    const xp = totalXp(vs)
    return {
      worker,
      reliability: reliability(vs),
      xp,
      level: level(xp),
      missions: quorumResults(vs).map(({ verdict: v }) => ({
        missionId: v.missionId, outcome: v.outcome, steps: v.steps, collisions: v.collisions, difficultyClass: v.difficultyClass, entityKey: v.$key,
      })),
    }
  }).sort((a, b) => b.level - a.level || b.xp - a.xp)
}
