// The Missions this machine has run, from runs/<missionId>/events.*.ndjson: where each one stands, filtered and paged.
import { existsSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

/** Finished Missions are history; live ones are still in Bidding, Stake, Run or Verify. */
export type RunStatus = "live" | "passed" | "failed" | "unsettled"
export type RunStage = "bidding" | "awarded" | "running" | "verifying"
export type RunSummary = {
  missionId: string
  status: RunStatus
  /** The settled Outcome: Pass, Fail or NoShow. */
  outcome?: string
  /** Live only: the Mission page's stage. */
  stage?: RunStage
  /** Unsettled only: why no Outcome came. */
  reason?: "No Bids" | "Stalled"
  postedAt?: number
  /** The latest event, ms. History sorts by it. */
  updatedAt: number
  posted?: { difficultyClass: string; task?: string; maxBounty: string; riskWeight: number; biddingClosesAt: number; maxSteps?: number; maxCollisions?: number }
  workerName?: string
  decisions: number
  workerPayout?: string
}
export type RunPage = { items: RunSummary[]; total: number; page: number; pages: number; per: number; counts: Record<RunStatus, number> }

/** No event for this long and no Outcome: the Mission is past any deadline a demo uses, so it is history, not live. */
export const STALLED_MS = 60 * 60 * 1000
/** Bidding closed this long ago with no Bid: nobody will bid now. */
const NO_BIDS_GRACE_MS = 60 * 1000

type Facts = Omit<RunSummary, "status" | "stage" | "reason"> & { bids: number; phase: RunStage | null }

/** What the events of one Mission say, before the clock is applied. Pure. */
export function factsOf(missionId: string, events: { ts: string; type: string; data: any }[]): Facts {
  const f: Facts = { missionId, updatedAt: 0, decisions: 0, bids: 0, phase: null }
  let award = false, decided = false, submitted = false
  const names = new Map<string, string>()
  let winner: string | undefined
  for (const e of events) {
    f.updatedAt = Math.max(f.updatedAt, Date.parse(e.ts) || 0)
    switch (e.type) {
      case "mission.posted": f.posted = e.data; f.postedAt = Date.parse(e.ts); break
      case "bid.sealed": f.bids++; names.set(String(e.data?.worker).toLowerCase(), e.data?.workerName); break
      case "bids.revealed": winner = String(e.data?.winner).toLowerCase(); break
      case "award.signed": award = true; winner = String(e.data?.worker).toLowerCase(); break
      case "decision.made": f.decisions++; decided = true; break
      case "episode.submitted": submitted = true; break
      case "settled": f.outcome = e.data?.outcome; f.workerPayout = e.data?.workerPayout; break
    }
  }
  if (winner) f.workerName = names.get(winner)
  f.phase = submitted ? "verifying" : decided ? "running" : award ? "awarded" : "bidding"
  return f
}

/** Where a Mission stands now. A No-show is a Fail (GLOSSARY). */
export function statusOf(f: Facts, now: number): Pick<RunSummary, "status" | "stage" | "reason"> {
  if (f.outcome) return { status: f.outcome === "Pass" ? "passed" : "failed" }
  const closes = (f.posted?.biddingClosesAt ?? 0) * 1000
  if (f.bids === 0 && closes > 0 && now > closes + NO_BIDS_GRACE_MS) return { status: "unsettled", reason: "No Bids" }
  if (now - f.updatedAt > STALLED_MS) return { status: "unsettled", reason: "Stalled" }
  return { status: "live", stage: f.phase ?? "bidding" }
}

export type RunQuery = { view: "history" | "live"; status?: string; page: number; per: number }

/** One page of Missions. History is newest-settled first; live is most recently active first. Counts ignore the filter. */
export function pageRuns(facts: Facts[], q: RunQuery, now: number): RunPage {
  const all = facts.map((f) => {
    const { bids: _b, phase: _p, ...rest } = f
    return { ...rest, ...statusOf(f, now) } as RunSummary
  }).sort((a, b) => b.updatedAt - a.updatedAt)
  const counts: Record<RunStatus, number> = { live: 0, passed: 0, failed: 0, unsettled: 0 }
  for (const r of all) counts[r.status]++
  const wanted = q.view === "live" ? ["live"]
    : q.status === "passed" || q.status === "failed" || q.status === "unsettled" ? [q.status] : ["passed", "failed", "unsettled"]
  // Live lists what is past the Mission Board: a Mission still open for bidding is on the Board already.
  const onBoard = (r: RunSummary) => r.stage === "bidding" && (r.posted?.biddingClosesAt ?? 0) * 1000 > now
  const matched = all.filter((r) => wanted.includes(r.status) && !(q.view === "live" && onBoard(r)))
  const per = Math.min(50, Math.max(1, q.per))
  const pages = Math.max(1, Math.ceil(matched.length / per))
  const page = Math.min(pages, Math.max(1, q.page))
  return { items: matched.slice((page - 1) * per, page * per), total: matched.length, page, pages, per, counts }
}

export function parseRunQuery(params: URLSearchParams): RunQuery {
  const n = (k: string, d: number) => { const v = Number.parseInt(params.get(k) ?? "", 10); return Number.isFinite(v) ? v : d }
  return { view: params.get("view") === "live" ? "live" : "history", status: params.get("status") ?? undefined, page: n("page", 1), per: n("per", 10) }
}

/**
 * Reads every Mission folder, re-parsing only those whose event files changed since the last call (the lists poll
 * every couple of seconds). `read` returns one file's parsed events.
 */
export function runIndex(RUNS: string, isMission: (d: string) => boolean, eventFiles: (dir: string) => string[], read: (path: string) => any[]) {
  const cache = new Map<string, { sig: string; facts: Facts }>()
  return (): Facts[] => {
    if (!existsSync(RUNS)) return []
    const out: Facts[] = []
    for (const id of readdirSync(RUNS).filter(isMission)) {
      const dir = join(RUNS, id)
      const names = eventFiles(dir)
      const sig = names.map((n) => { const s = statSync(join(dir, n)); return `${n}:${s.size}:${s.mtimeMs}` }).join("|")
      let hit = cache.get(id)
      if (hit?.sig !== sig) {
        const events = names.flatMap((n) => read(join(dir, n))).sort((a, b) => String(a.ts).localeCompare(String(b.ts)))
        const facts = factsOf(id, events)
        if (!facts.updatedAt) facts.updatedAt = statSync(dir).mtimeMs
        hit = { sig, facts }
        cache.set(id, hit)
      }
      out.push(hit.facts)
    }
    return out
  }
}
