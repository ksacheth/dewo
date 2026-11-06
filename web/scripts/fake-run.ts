// Emits a plausible full Mission through the real emit(): the test fixture, and a way to build the UI before M4/M5 exist.
// pnpm --filter web fake-run [delayMs]   (default 800 ms between Decisions)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { deflateSync } from "node:zlib"
import { randomBytes } from "node:crypto"
import { emit, runsDir } from "@dewo/board"

const crc = (b: Buffer) => {
  let c = ~0
  for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1 }
  return ~c >>> 0
}
const chunk = (type: string, data: Buffer) => {
  const t = Buffer.concat([Buffer.from(type), data])
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0); t.copy(out, 4); out.writeUInt32BE(crc(t), 8 + data.length)
  return out
}
/** A solid-colour 32x32 PNG with a moving square, so frames visibly change. */
function png(step: number): Buffer {
  const w = 32, rows: Buffer[] = []
  for (let y = 0; y < w; y++) {
    const r = Buffer.alloc(1 + w * 3)
    for (let x = 0; x < w; x++) {
      const on = Math.abs(x - (2 + step * 2)) < 3 && Math.abs(y - 16) < 3
      r.set(on ? [255, 200, 40] : [30 + y, 40, 70], 1 + x * 3)
    }
    rows.push(r)
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(w, 4); ihdr.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))])
}

const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`
const WORKERS = [
  { name: "Careful", worker: addr(0xc1), price: "9400000", R: 0.95 },
  { name: "Cheap and Blind", worker: addr(0xc2), price: "4800000", R: 0.67 },
  { name: "Gambler", worker: addr(0xc3), price: "4300000", R: 0.5 },
]
const VERIFIERS = [addr(0xe1), addr(0xe2), addr(0xe3)]
// The sim's golden Course and its solving Actions, so the Result map draws a route that really avoids the obstacles.
const FIX = fileURLToPath(new URL("../../sim/tests/fixtures/", import.meta.url))
const fixture = (name: string) => (existsSync(`${FIX}${name}`) ? JSON.parse(readFileSync(`${FIX}${name}`, "utf8")) : null)
const ACTIONS: string[] = fixture("actions_medium.json") ?? ["FORWARD", "FORWARD", "TURN_LEFT", "FORWARD", "FORWARD", "FORWARD", "TURN_RIGHT", "FORWARD", "FORWARD", "FORWARD", "TURN_LEFT", "FORWARD", "FORWARD", "FORWARD", "FORWARD"]
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const hs = (id: string) => `https://hashscan.io/testnet/transaction/${id}`

/** Writes one complete winning Mission to <dir>/<missionId>/ and returns its id. */
export async function fakeRun({ dir = runsDir(), delayMs = 800, missionId = `0x${randomBytes(32).toString("hex")}` }: { dir?: string; delayMs?: number; missionId?: string } = {}) {
  process.env.RUNS_DIR = dir
  mkdirSync(join(dir, missionId, "frames"), { recursive: true })
  const course = fixture("course_medium.json")
  if (course) writeFileSync(join(dir, missionId, "course.json"), JSON.stringify(course))
  const e = emit
  e(missionId, "requester", { type: "mission.posted", data: { difficultyClass: "medium", task: "rover", maxBounty: "10000000", riskWeight: 0.5, maxSteps: 60, maxCollisions: 0, biddingClosesAt: Math.floor(Date.now() / 1000) + 60, arkivKey: addr(0xa1) }, txUrl: hs("0.0.1001@1.1") })
  for (const w of WORKERS) { e(missionId, `worker-${w.name.toLowerCase().replace(/ /g, "-")}`, { type: "bid.sealed", data: { worker: w.worker, workerName: w.name, policyHash: `0x${w.name.length}abc`, arkivKey: addr(0xb0 + w.name.length) } }); await sleep(Math.max(2, delayMs / 4)) }
  const winner = WORKERS[1]
  e(missionId, "verifier-1", { type: "bids.revealed", data: { bids: WORKERS.map((w) => ({ worker: w.worker, workerName: w.name, price: w.price, R: w.R, score: w.R ** 0.5 / (Number(w.price) / 1e6) ** 0.5 })), winner: winner.worker } })
  await sleep(2) // distinct timestamps, so replay order is unambiguous
  e(missionId, "verifier-1", { type: "award.signed", data: { worker: winner.worker, price: winner.price, stake: "790000", verifier: VERIFIERS[0] }, txUrl: hs("0.0.1002@2.2") })
  await sleep(2) // distinct timestamps, so replay order is unambiguous
  e(missionId, "worker-cheap-and-blind", { type: "stake.deposited", data: { worker: winner.worker, stake: "790000" }, txUrl: hs("0.0.1003@3.3") })
  await sleep(2) // distinct timestamps, so replay order is unambiguous
  for (let i = 0; i < 15; i++) {
    writeFileSync(join(dir, missionId, "frames", `${String(i + 1).padStart(3, "0")}.png`), png(i))
    e(missionId, "worker-cheap-and-blind", { type: "decision.made", data: { step: i, frame: `${missionId}/frames/${String(i + 1).padStart(3, "0")}.png`, chatID: `chat-${randomBytes(6).toString("hex")}`, action: ACTIONS[i] } })
    await sleep(delayMs)
  }
  e(missionId, "worker-cheap-and-blind", { type: "episode.submitted", data: { episodeLogRoot: "0xroot123", policyRoot: "0xpolicy456", decisionCount: 15 }, txUrl: "https://chainscan-galileo.0g.ai/tx/0xdeadbeef" })
  for (const [i, v] of VERIFIERS.entries()) {
    // D15: the Requester reports the 402 challenge; the Verifier owns "paid" with the settlement link.
    e(missionId, "requester", { type: "replay.paid", data: { verifier: v, status: 402, amount: "50000" } })
    await sleep(Math.max(2, delayMs / 4))
    e(missionId, `verifier-${i + 1}`, { type: "replay.paid", data: { verifier: v, status: "paid", amount: "50000" }, txUrl: hs(`0.0.2000@${i}.1`) })
  }
  for (const [i, v] of VERIFIERS.slice(0, 2).entries()) { await sleep(Math.max(2, delayMs / 2)); e(missionId, `verifier-${i + 1}`, { type: "verdict.signed", data: { verifier: v, outcome: "Pass", evidenceHash: "0xevidence", arkivKey: addr(0xf0 + i) } }) }
  e(missionId, "requester", { type: "settled", data: { outcome: "Pass", workerPayout: "5590000", requesterPayout: "5200000" }, txUrl: hs("0.0.3000@9.9") })
  return missionId
}

/** Demo only: Verdict entities in the mock board, so the Result and the Leaderboard have data (one Fail included). Needs VERIFIER_ADDRESSES. */
async function seedBoard(missionId: string, dir: string) {
  if (existsSync(".env")) process.loadEnvFile(".env")
  const verifiers = (process.env.VERIFIER_ADDRESSES ?? "").split(",").filter(Boolean)
  if (!verifiers.length) return console.log("VERIFIER_ADDRESSES not set: skipped seeding Verdicts")
  process.env.RUNS_DIR = dir
  const { seedMock } = await import("@dewo/board/mock")
  const hex = (n = 32) => `0x${randomBytes(n).toString("hex")}`
  const row = (worker: string, id: string, outcome: string, pathCost: number, optimalPathCost: number, collisions: number, owner: string, ago: number, evidenceHash: string, episodeLogRoot: string) => ({
    missionId: id, worker, outcome, pathCost, optimalPathCost, collisions, difficultyClass: "medium", signature: hex(65), evidenceHash, episodeLogRoot,
    pathQuality: pathCost ? Math.min(1, optimalPathCost / pathCost) : 0,
    $key: hex(), $owner: owner, $createdAt: Date.now() - ago, $expiresAt: Date.now() + 86_400_000,
  })
  // Two Verifiers sign the same evidence, which is what makes a Quorum.
  const pair = (worker: string, id: string, outcome: string, pc: number, opt: number, col: number, ago: number) => {
    const evidence = hex(), log = hex()
    return verifiers.slice(0, 2).map((v) => row(worker, id, outcome, pc, opt, col, v, ago, evidence, log))
  }
  seedMock({
    verdicts: [
      ...pair(WORKERS[1].worker, missionId, "Pass", 15, 15, 0, 0),
      ...pair(WORKERS[0].worker, hex(), "Pass", 12, 11, 0, 60_000), ...pair(WORKERS[0].worker, hex(), "Pass", 14, 12, 0, 120_000),
      ...pair(WORKERS[2].worker, hex(), "Fail", 9, 11, 1, 90_000), ...pair(WORKERS[2].worker, hex(), "Pass", 17, 12, 0, 150_000),
      ...pair(WORKERS[1].worker, hex(), "Pass", 13, 12, 0, 180_000),
    ] as never,
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const id = await fakeRun({ delayMs: Number(process.argv[2] ?? 800) })
  await seedBoard(id, runsDir())
  console.log(`fake Mission ${id} written to ${runsDir()}`)
}
