import { ExpirationTime } from "@arkiv-network/sdk"
import { and, asc, eq, gt } from "@arkiv-network/sdk/query"
import type { Expression } from "@arkiv-network/sdk/query"
import { addr, dec, i32, u64, u256 } from "@arkiv-network/sdk/schema"
import { fetchAll, plain, readClient } from "./client"
import type { Wallet, Written } from "./client"
import { Mission } from "./schemas"
import type { DifficultyClass, Hex, MissionInput, MissionRow, MissionStatus } from "./schemas"

/** D1: a Mission lives 60 min (the rescue deadline); the board hides it once biddingClosesAt passes. */
export async function postMission(wallet: Wallet, m: MissionInput): Promise<Written> {
  return wallet.createEntity(
    Mission,
    {
      missionId: m.missionId,
      difficultyClass: m.difficultyClass,
      bounty: u256(m.bounty),
      stepBudget: i32(m.stepBudget),
      status: "open",
      requester: addr(wallet.account.address),
      biddingClosesAt: u64(BigInt(Math.floor(m.biddingClosesAt))),
      seedCommitment: m.seedCommitment,
      riskWeight: dec(String(m.riskWeight)),
      escrowMissionId: m.missionId,
      verifiers: m.verifiers,
    },
    { expiration: ExpirationTime.fromMinutes(60) },
  )
}

export async function setMissionStatus(wallet: Wallet, entityKey: Hex, status: MissionStatus): Promise<Written> {
  const { txHash } = await wallet.patchEntity(Mission, entityKey, { set: { status } })
  return { entityKey, txHash }
}

export async function listOpenMissions(filter: { difficultyClass?: DifficultyClass; requester?: Hex } = {}): Promise<MissionRow[]> {
  const nowSec = BigInt(Math.floor(Date.now() / 1000))
  const conditions: Expression[] = [eq("status", "open"), gt("biddingClosesAt", u64(nowSec))]
  if (filter.difficultyClass) conditions.push(eq("difficultyClass", filter.difficultyClass))
  if (filter.requester) conditions.push(eq("requester", addr(filter.requester)))
  const rows = await fetchAll<Record<string, unknown>>((offset) =>
    readClient().select().from(Mission).where(and(...conditions) as never).orderBy(asc("$key")).limit(100).offset(offset).fetch(),
  )
  return rows.map((r) => plain<MissionRow>(r)).sort((a, b) => a.biddingClosesAt - b.biddingClosesAt)
}

/** Anyone may post a Mission entity, so a duplicate missionId is possible; the earliest wins and we warn. */
export async function getMission(missionId: Hex): Promise<MissionRow | null> {
  const { entities } = await readClient().select().from(Mission).where(eq("missionId", missionId)).limit(10).fetch()
  const rows = entities.map((r) => plain<MissionRow>(r as never)).sort((a, b) => a.$createdAt - b.$createdAt)
  if (rows.length > 1) console.warn(`board: ${rows.length} Mission entities claim ${missionId}; using the earliest`)
  return rows[0] ?? null
}
