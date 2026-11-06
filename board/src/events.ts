// I8 event feed: types are browser-safe; emit() is Node-only and loads fs lazily.
export type EventType =
  | "mission.posted" | "bid.sealed" | "bids.revealed" | "award.signed" | "stake.deposited"
  | "decision.made" | "rover.moved" | "episode.submitted" | "replay.paid" | "verdict.signed" | "settled"

type Addr = string
export type EventData = {
  "mission.posted": { difficultyClass: string; maxBounty: string; riskWeight: number; maxSteps: number; maxCollisions: number; biddingClosesAt: number; arkivKey: string }
  "bid.sealed": { worker: Addr; workerName: string; policyHash: string; arkivKey: string }
  "bids.revealed": { bids: { worker: Addr; workerName: string; price: string; R: number; score: number }[]; winner: Addr }
  "award.signed": { worker: Addr; price: string; stake: string; verifier: Addr }
  "stake.deposited": { worker: Addr; stake: string }
  /** frame is a path relative to the runs/ folder */
  "decision.made": { step: number; frame: string; chatID: string; action: string }
  /** Display only: whole-arena images of one move, paths relative to the runs/ folder */
  "rover.moved": { step: number; images: string[]; collision: boolean; atGoal: boolean }
  "episode.submitted": { episodeLogRoot: string; policyRoot: string; decisionCount: number }
  "replay.paid": { verifier: Addr; status: 402 | "paid"; amount: string }
  "verdict.signed": { verifier: Addr; outcome: string; evidenceHash: string; arkivKey: string }
  settled: { outcome: string; workerPayout: string; requesterPayout: string }
}

export type DewoEvent<T extends EventType = EventType> = {
  ts: string
  type: T
  missionId: string
  data: EventData[T]
  txUrl?: string
}

const MISSION_ID = /^0x[0-9a-fA-F]{64}$/
const PROCESS = /^[a-z0-9-]+$/

/** RUNS_DIR, else <repo root>/runs where the root is the nearest parent holding pnpm-workspace.yaml. */
export function runsDir(): string {
  if (process.env.RUNS_DIR) return process.env.RUNS_DIR
  const fs = process.getBuiltinModule("node:fs")
  const path = process.getBuiltinModule("node:path")
  let dir = process.cwd()
  while (!fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
    const up = path.dirname(dir)
    if (up === dir) throw new Error("pnpm-workspace.yaml not found; set RUNS_DIR")
    dir = up
  }
  return path.join(dir, "runs")
}

/** Appends one JSON line to runs/<missionId>/events.<process>.ndjson (one file per process, no write races). */
export function emit<T extends EventType>(
  missionId: string,
  process_: string,
  event: { type: T; data: Partial<EventData[T]> | EventData[T]; txUrl?: string },
): void {
  if (!MISSION_ID.test(missionId)) throw new Error(`invalid missionId: ${missionId}`)
  if (!PROCESS.test(process_)) throw new Error(`invalid process name: ${process_}`)
  const fs = process.getBuiltinModule("node:fs")
  const path = process.getBuiltinModule("node:path")
  const dir = path.join(runsDir(), missionId)
  fs.mkdirSync(dir, { recursive: true })
  const line: DewoEvent = { ts: new Date().toISOString(), type: event.type, missionId, data: event.data as never, ...(event.txUrl && { txUrl: event.txUrl }) }
  fs.appendFileSync(path.join(dir, `events.${process_}.ndjson`), JSON.stringify(line) + "\n")
}
