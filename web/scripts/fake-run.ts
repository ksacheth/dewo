// Emits a plausible full Mission through the real emit(): the test fixture, and a way to build the UI before M4/M5 exist.
// pnpm --filter web fake-run [delayMs] [missionId] [rover|drone]   (default 800 ms between Decisions; pass the id of a Mission posted from the UI to drive it)
// With a demo reel in runs/_reels/ (scripts/demo-reel.py) the run is a real sim run: its Course, the onboard frames
// the model would see and the MuJoCo arena images as rover.moved events. Without one it draws placeholder squares.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
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
/** A real sim run saved by scripts/demo-reel.py; paths are relative to its folder. */
type Reel = { task: string; difficulty: string; decisions: { step: number; frame: string; action: string }[]; moves: { step: number; images: string[]; collision: boolean; atGoal: boolean }[] }
/** The reel for this task, preferring the difficulty asked for. */
function findReel(dir: string, task: string, difficulty: string): { reel: Reel; base: string } | null {
  const root = join(dir, "_reels")
  if (!existsSync(root)) return null
  const names = readdirSync(root).filter((n) => n.startsWith(`${task}-`) && existsSync(join(root, n, "reel.json")))
  const name = names.find((n) => n === `${task}-${difficulty}`) ?? names[0]
  return name ? { reel: JSON.parse(readFileSync(join(root, name, "reel.json"), "utf8")), base: `_reels/${name}` } : null
}
/** The mission.posted a Mission posted from the UI already has. */
function postedOf(dir: string, missionId: string): { task?: string; difficultyClass?: string } | null {
  const folder = join(dir, missionId)
  if (!existsSync(folder)) return null
  for (const f of readdirSync(folder).filter((n) => n.endsWith(".ndjson")))
    for (const line of readFileSync(join(folder, f), "utf8").split("\n").filter(Boolean)) {
      const e = JSON.parse(line)
      if (e.type === "mission.posted") return e.data
    }
  return {}
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const hs = (id: string) => `https://hashscan.io/testnet/transaction/${id}`

/** Writes one complete winning Mission to <dir>/<missionId>/ and returns its id. */
/** `stageMs` is the pause before the Award, the stake and the first Decision, so a watched run shows each stage. */
export async function fakeRun({ dir = runsDir(), delayMs = 800, stageMs = 2, missionId = `0x${randomBytes(32).toString("hex")}`, task = "rover" }: { dir?: string; delayMs?: number; stageMs?: number; missionId?: string; task?: string } = {}) {
  process.env.RUNS_DIR = dir
  const posted = postedOf(dir, missionId) // a Mission already posted from the UI keeps its own mission.posted
  const found = findReel(dir, posted?.task ?? task, posted?.difficultyClass ?? "medium")
  mkdirSync(join(dir, missionId, "frames"), { recursive: true })
  const course = found ? JSON.parse(readFileSync(join(dir, found.base, "course.json"), "utf8")) : fixture("course_medium.json")
  if (course) writeFileSync(join(dir, missionId, "course.json"), JSON.stringify(course))
  const e = emit
  if (!posted) e(missionId, "requester", { type: "mission.posted", data: { difficultyClass: found?.reel.difficulty ?? "medium", task: found?.reel.task ?? "rover", maxBounty: "10000000", riskWeight: 0.5, maxSteps: 60, maxCollisions: 0, biddingClosesAt: Math.floor(Date.now() / 1000) + 60, arkivKey: addr(0xa1) }, txUrl: hs("0.0.1001@1.1") })
  for (const w of WORKERS) { e(missionId, `worker-${w.name.toLowerCase().replace(/ /g, "-")}`, { type: "bid.sealed", data: { worker: w.worker, workerName: w.name, policyHash: `0x${w.name.length}abc`, arkivKey: addr(0xb0 + w.name.length) } }); await sleep(Math.max(2, stageMs / 2)) }
  const winner = WORKERS[1]
  e(missionId, "verifier-1", { type: "bids.revealed", data: { bids: WORKERS.map((w) => ({ worker: w.worker, workerName: w.name, price: w.price, R: w.R, score: w.R ** 0.5 / (Number(w.price) / 1e6) ** 0.5 })), winner: winner.worker } })
  await sleep(stageMs) // distinct timestamps, so replay order is unambiguous
  e(missionId, "verifier-1", { type: "award.signed", data: { worker: winner.worker, price: winner.price, stake: "790000", verifier: VERIFIERS[0] }, txUrl: hs("0.0.1002@2.2") })
  await sleep(stageMs) // distinct timestamps, so replay order is unambiguous
  e(missionId, "worker-cheap-and-blind", { type: "stake.deposited", data: { worker: winner.worker, stake: "790000" }, txUrl: hs("0.0.1003@3.3") })
  await sleep(stageMs) // distinct timestamps, so replay order is unambiguous
  const worker = "worker-cheap-and-blind"
  const chat = () => `chat-${randomBytes(6).toString("hex")}`
  let decisionCount = 15
  if (found) {
    // Like the Worker: the arena view answers a move once it has seen the next, so each rover.moved lands one move late.
    const { reel, base } = found
    const moved = (k: number) => { const m = reel.moves[k]; if (m) e(missionId, worker, { type: "rover.moved", data: { ...m, images: m.images.map((i) => `${base}/${i}`) } }) }
    for (const d of reel.decisions) {
      e(missionId, worker, { type: "decision.made", data: { step: d.step, frame: `${base}/${d.frame}`, chatID: chat(), action: d.action } })
      moved(d.step)
      await sleep(delayMs)
    }
    for (let k = reel.decisions.length; k < reel.moves.length; k++) moved(k)
    decisionCount = reel.decisions.length
  } else {
    for (let i = 0; i < 15; i++) {
      writeFileSync(join(dir, missionId, "frames", `${String(i + 1).padStart(3, "0")}.png`), png(i))
      e(missionId, worker, { type: "decision.made", data: { step: i, frame: `${missionId}/frames/${String(i + 1).padStart(3, "0")}.png`, chatID: chat(), action: ACTIONS[i] } })
      await sleep(delayMs)
    }
  }
  e(missionId, worker, { type: "episode.submitted", data: { episodeLogRoot: "0xroot123", policyRoot: "0xpolicy456", decisionCount }, txUrl: "https://chainscan-galileo.0g.ai/tx/0xdeadbeef" })
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
  const row = (worker: string, id: string, outcome: string, steps: number, collisions: number, owner: string, ago: number, evidenceHash: string, episodeLogRoot: string) => ({
    missionId: id, worker, outcome, steps, collisions, difficultyClass: "medium", signature: hex(65), evidenceHash, episodeLogRoot,
    $key: hex(), $owner: owner, $createdAt: Date.now() - ago, $expiresAt: Date.now() + 86_400_000,
  })
  // Two Verifiers sign the same evidence, which is what makes a Quorum.
  const pair = (worker: string, id: string, outcome: string, steps: number, col: number, ago: number) => {
    const evidence = hex(), log = hex()
    return verifiers.slice(0, 2).map((v) => row(worker, id, outcome, steps, col, v, ago, evidence, log))
  }
  seedMock({
    verdicts: [
      ...pair(WORKERS[1].worker, missionId, "Pass", 15, 0, 0),
      ...pair(WORKERS[0].worker, hex(), "Pass", 12, 0, 60_000), ...pair(WORKERS[0].worker, hex(), "Pass", 14, 0, 120_000),
      ...pair(WORKERS[2].worker, hex(), "Fail", 9, 1, 90_000), ...pair(WORKERS[2].worker, hex(), "Pass", 17, 0, 150_000),
      ...pair(WORKERS[1].worker, hex(), "Pass", 13, 0, 180_000),
    ] as never,
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Arguments in any order: a number is the delay, a 0x id the Mission, rover or drone the task of a new Mission.
  const args = process.argv.slice(2)
  const delayMs = Number(args.find((a) => /^\d+$/.test(a)) ?? 800)
  const missionId = args.find((a) => a.startsWith("0x"))
  const task = args.find((a) => a === "rover" || a === "drone") ?? "rover"
  if (missionId && !/^0x[0-9a-fA-F]{64}$/.test(missionId)) throw new Error("missionId must be a 0x-prefixed 32-byte hex")
  const id = await fakeRun({ delayMs, stageMs: delayMs * 4, task, ...(missionId && { missionId }) })
  await seedBoard(id, runsDir())
  console.log(`fake Mission ${id} written to ${runsDir()}`)
}
