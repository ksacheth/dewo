import { bytesToHex, hexToBytes } from "viem"
import { ExpirationTime } from "@arkiv-network/sdk"
import { and, asc, eq, or } from "@arkiv-network/sdk/query"
import type { Expression } from "@arkiv-network/sdk/query"
import { addr, i32 } from "@arkiv-network/sdk/schema"
import { fetchAll, plain, readClient } from "./client"
import type { Wallet, Written } from "./client"
import { LIFETIME_MS, Verdict } from "./schemas"
import type { VerdictInput } from "./schemas"
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
export function leaderboardFrom(verdicts: VerdictRow[], verifiers: readonly Hex[]): LeaderboardRow[] {
  const byWorker = new Map<Hex, VerdictRow[]>()
  for (const v of verdicts) byWorker.set(v.worker, [...(byWorker.get(v.worker) ?? []), v])
  return [...byWorker].map(([worker, vs]) => {
    const xp = totalXp(vs, verifiers)
    return {
      worker,
      reliability: reliability(vs, verifiers),
      xp,
      level: level(xp),
      missions: quorumResults(vs, verifiers).map(({ verdict: v }) => ({
        missionId: v.missionId, outcome: v.outcome, steps: v.steps, collisions: v.collisions, difficultyClass: v.difficultyClass, entityKey: v.$key,
      })),
    }
  }).sort((a, b) => b.level - a.level || b.xp - a.xp)
}

/** Readonly and long-lived (leaderboard history), kept under the chain's ~182 day maximum. */
export async function writeVerdict(wallet: Wallet, v: VerdictInput): Promise<Written> {
  return wallet.createEntity(
    Verdict,
    { ...v, signature: hexToBytes(v.signature as `0x${string}`), worker: addr(v.worker), steps: i32(v.steps), collisions: i32(v.collisions) },
    { expiration: ExpirationTime.fromSeconds(LIFETIME_MS.verdict / 1000), flags: { readonly: true } },
  )
}

/** Newest first; only entities owned by a trusted Verifier (D5). */
export async function listVerdicts(filter: VerdictFilter = {}): Promise<VerdictRow[]> {
  const conditions: Expression[] = [or(...trustedVerifiers().map((a) => eq("$owner", addr(a))))]
  if (filter.worker) conditions.push(eq("worker", addr(filter.worker)))
  if (filter.missionId) conditions.push(eq("missionId", filter.missionId))
  if (filter.outcome) conditions.push(eq("outcome", filter.outcome))
  const rows = await fetchAll<Record<string, unknown>>((offset) =>
    readClient().select().from(Verdict).where(and(...conditions) as never).orderBy(asc("$key")).limit(100).offset(offset).fetch(),
  )
  return rows.map((r) => plain<VerdictRow>(r)).map((r) => ({ ...r, signature: bytesToHex(r.signature as unknown as Uint8Array) })).sort((a, b) => b.$createdAt - a.$createdAt || (a.$key < b.$key ? -1 : 1))
}

export async function leaderboard(): Promise<LeaderboardRow[]> {
  return leaderboardFrom(await listVerdicts(), trustedVerifiers())
}
