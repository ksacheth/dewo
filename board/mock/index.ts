// File-backed mock with the same exports and signatures as the real library (D6).
// State lives in BOARD_MOCK_FILE so separate processes (agents, Verifiers, web) share it.
// Pure modules are re-exported unchanged; only the entity functions are re-implemented here.
import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { privateKeyToAccount, publicKeyToAddress } from "viem/accounts"
import { decrypt, encrypt } from "../src/crypto"
import { firstBidPerWorker } from "../src/bids"
import { runsDir } from "../src/events"
import { LIFETIME_MS } from "../src/schemas"
import type { BidInput, BidRow, DifficultyClass, Hex, MissionInput, MissionRow, MissionStatus, SeedReleaseRow, VerdictInput, VerdictRow, WalletLike } from "../src/schemas"
import { leaderboardFrom, trustedVerifiers } from "../src/verdicts"
import type { LeaderboardRow, VerdictFilter } from "../src/verdicts"

export * from "../src/schemas"
export * from "../src/crypto"
export * from "../src/scoring"
export * from "../src/events"
export { BidOpenError, openBid, sealBid } from "../src/bids"
export { leaderboardFrom, trustedVerifiers } from "../src/verdicts"
export type { LeaderboardRow, VerdictFilter } from "../src/verdicts"

type Store = { missions: MissionRow[]; bids: BidRow[]; seedReleases: SeedReleaseRow[]; verdicts: VerdictRow[] }
const empty = (): Store => ({ missions: [], bids: [], seedReleases: [], verdicts: [] })
type Written = { entityKey: Hex; txHash: Hex }

// JSON can't hold bigint or bytes, so tag them.
const replacer = (_: string, v: unknown) =>
  typeof v === "bigint" ? { $big: v.toString() } : v instanceof Uint8Array ? { $hex: Buffer.from(v).toString("hex") } : v
const reviver = (_: string, v: unknown) => {
  const o = v as { $big?: string; $hex?: string } | null
  if (o && typeof o === "object" && typeof o.$big === "string") return BigInt(o.$big)
  if (o && typeof o === "object" && typeof o.$hex === "string") return Uint8Array.from(Buffer.from(o.$hex, "hex"))
  return v
}

const file = () => process.env.BOARD_MOCK_FILE ?? join(runsDir(), "board-mock.json")
const load = (): Store => (existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8"), reviver) : empty())
function save(s: Store) {
  mkdirSync(dirname(file()), { recursive: true })
  const tmp = `${file()}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(s, replacer))
  renameSync(tmp, file()) // atomic, so a reader never sees half a write
}
const live = <T extends { $expiresAt: number }>(rows: T[]) => rows.filter((r) => r.$expiresAt > Date.now())
const newKey = () => `0x${randomBytes(32).toString("hex")}` as Hex
const meta = (owner: Hex, lifetime: number) => ({ $key: newKey(), $owner: owner, $createdAt: Date.now(), $expiresAt: Date.now() + lifetime })
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

function write<K extends keyof Store>(table: K, build: (s: Store) => Store[K][number]): Written {
  const s = load()
  const row = build(s)
  ;(s[table] as unknown[]).push(row)
  save(s)
  return { entityKey: (row as { $key: Hex }).$key, txHash: newKey() }
}

/** Tests and demos only: wipe the store. */
export const resetMock = () => save(empty())
/** Tests and demos only: append raw rows (for example to seed a leaderboard). */
export function seedMock(rows: Partial<Store>) {
  const s = load()
  for (const k of Object.keys(rows) as (keyof Store)[]) (s[k] as unknown[]).push(...(rows[k] as unknown[]))
  save(s)
}

export async function postMission(wallet: WalletLike, m: MissionInput): Promise<Written> {
  const requester = wallet.account.address
  return write("missions", () => ({ ...m, ...meta(requester, LIFETIME_MS.mission), status: "open", requester, escrowMissionId: m.missionId }))
}

export async function setMissionStatus(wallet: WalletLike, entityKey: Hex, status: MissionStatus): Promise<Written> {
  const s = load()
  const row = s.missions.find((m) => m.$key === entityKey)
  if (!row) throw new Error(`no Mission entity ${entityKey}`)
  if (!same(row.$owner, wallet.account.address)) throw new Error("only the Requester can change a Mission's status")
  row.status = status
  save(s)
  return { entityKey, txHash: newKey() }
}

export async function listOpenMissions(filter: { difficultyClass?: DifficultyClass; requester?: Hex } = {}): Promise<MissionRow[]> {
  const nowSec = Date.now() / 1000
  return live(load().missions)
    .filter((m) => m.status === "open" && m.biddingClosesAt > nowSec)
    .filter((m) => !filter.difficultyClass || m.difficultyClass === filter.difficultyClass)
    .filter((m) => !filter.requester || same(m.requester, filter.requester))
    .sort((a, b) => a.biddingClosesAt - b.biddingClosesAt)
}

export async function getMission(missionId: Hex): Promise<MissionRow | null> {
  const found = live(load().missions).filter((m) => m.missionId === missionId).sort((a, b) => a.$createdAt - b.$createdAt)
  if (found.length > 1) console.warn(`board: ${found.length} Mission entities claim ${missionId}; using the earliest`)
  return found[0] ?? null
}

export async function placeBid(wallet: WalletLike, bid: BidInput): Promise<Written> {
  const worker = wallet.account.address
  return write("bids", () => ({ ...bid, ...meta(worker, LIFETIME_MS.bid), worker }))
}

export async function listBids(missionId: Hex): Promise<BidRow[]> {
  return firstBidPerWorker(live(load().bids).filter((b) => b.missionId === missionId))
}

export async function releaseSeed(wallet: WalletLike, missionId: Hex, seed: string, salt: string, workerPubKey: Hex): Promise<Written> {
  const owner = wallet.account.address
  const sealed = encrypt(workerPubKey, JSON.stringify({ seed, salt }))
  return write("seedReleases", () => ({ ...meta(owner, LIFETIME_MS.seedRelease), missionId, worker: publicKeyToAddress(workerPubKey), sealed }))
}

export async function readSeedRelease(missionId: Hex, workerPrivKey: Hex): Promise<{ seed: string; salt: string } | null> {
  const mission = await getMission(missionId)
  if (!mission) return null
  const worker = privateKeyToAccount(workerPrivKey).address
  const row = live(load().seedReleases).find((r) => r.missionId === missionId && same(r.worker, worker) && same(r.$owner, mission.requester))
  return row ? JSON.parse(decrypt(workerPrivKey, row.sealed)) : null
}

export async function writeVerdict(wallet: WalletLike, v: VerdictInput): Promise<Written> {
  const owner = wallet.account.address
  return write("verdicts", () => ({ ...v, ...meta(owner, LIFETIME_MS.verdict) }))
}

export async function listVerdicts(filter: VerdictFilter = {}): Promise<VerdictRow[]> {
  const trusted = trustedVerifiers()
  return live(load().verdicts)
    .filter((v) => trusted.some((t) => same(t, v.$owner)))
    .filter((v) => !filter.worker || same(v.worker, filter.worker))
    .filter((v) => !filter.missionId || v.missionId === filter.missionId)
    .filter((v) => !filter.outcome || v.outcome === filter.outcome)
    .sort((a, b) => b.$createdAt - a.$createdAt || (a.$key < b.$key ? -1 : 1))
}

export async function leaderboard(): Promise<LeaderboardRow[]> {
  return leaderboardFrom(await listVerdicts())
}
