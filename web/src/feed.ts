// One pure fold over the I8 event stream. The UI never invents state: if no event said it, it isn't shown.
import { useEffect, useMemo, useState } from "react"
import type { DewoEvent, EventData } from "@dewo/board"

type Of<T extends keyof EventData> = EventData[T]
/**
 * One Verifier's phase: idle, waiting (answered "not ready", free), replaying (a payment verified, Decisions being checked),
 * 402 (challenge reported), paid (settled), verdict (signed).
 */
export type VerifierStatus = "idle" | "waiting" | "replaying" | "402" | "paid" | "verdict"
export type VerifierView = {
  status: VerifierStatus; outcome?: string; evidenceHash?: string; txUrl?: string; amount?: string
  /** While waiting: why, and the unix second the wait ends if the Verifier said. */
  waiting?: { reason: string; readyAt?: number }
  /** While replaying: Decisions checked so far of the Episode's total. */
  progress?: { step: number; total: number }
}
export type MissionState = {
  missionId: string
  posted?: Of<"mission.posted">
  /** When the Mission was posted (ms), for the bidding countdown ring. */
  postedAt?: number
  sealedBids: Of<"bid.sealed">[]
  revealed?: Of<"bids.revealed">
  award?: Of<"award.signed"> & { txUrl?: string }
  /** When the Award landed (ms): the stake window runs from here. */
  awardedAt?: number
  stake?: Of<"stake.deposited"> & { txUrl?: string }
  decisions: (Of<"decision.made"> & { ts: string })[]
  moves: Of<"rover.moved">[]
  episode?: Of<"episode.submitted"> & { txUrl?: string }
  verifiers: Record<string, VerifierView>
  settled?: Of<"settled"> & { txUrl?: string }
  phase: "waiting" | "posted" | "bidding" | "awarded" | "staked" | "running" | "verifying" | "settled"
}

const RANK: Record<VerifierStatus, number> = { idle: 0, waiting: 1, replaying: 2, "402": 3, paid: 4, verdict: 5 }
/** A Verifier card only moves forward: events from different processes may arrive out of order. */
const later = (a: VerifierStatus, b: VerifierStatus) => (RANK[b] > RANK[a] ? b : a)

export const eventKey = (e: DewoEvent) => `${e.ts}|${e.type}|${JSON.stringify(e.data)}`

export function foldEvents(missionId: string, events: DewoEvent[]): MissionState {
  const s: MissionState = { missionId, sealedBids: [], decisions: [], moves: [], verifiers: {}, phase: "waiting" }
  const v = (addr: string) => (s.verifiers[addr] ??= { status: "idle" })
  // Stable sort: events with the same ts keep arrival order, so file timing doesn't matter.
  for (const e of [...events].sort((a, b) => a.ts.localeCompare(b.ts))) {
    const d = e.data as never
    switch (e.type) {
      case "mission.posted": s.posted = d; s.postedAt = Date.parse(e.ts); break
      case "bid.sealed": s.sealedBids.push(d); break
      case "bids.revealed": s.revealed = d; break
      case "award.signed": s.award = { ...(d as object), txUrl: e.txUrl } as never; s.awardedAt = Date.parse(e.ts); break
      case "stake.deposited": s.stake = { ...(d as object), txUrl: e.txUrl } as never; break
      case "decision.made": s.decisions.push({ ...(d as object), ts: e.ts } as never); break
      case "rover.moved": s.moves.push(d); break
      case "episode.submitted": s.episode = { ...(d as object), txUrl: e.txUrl } as never; break
      case "replay.waiting": {
        const x = d as Of<"replay.waiting">, card = v(x.verifier)
        if (RANK[card.status] <= RANK.waiting) Object.assign(card, { status: "waiting", waiting: { reason: x.reason, ...(x.readyAt !== undefined && { readyAt: x.readyAt }) } })
        break
      }
      case "replay.started": {
        const x = d as Of<"replay.started">, card = v(x.verifier)
        Object.assign(card, { status: later(card.status, "replaying"), progress: { step: card.progress?.step ?? 0, total: x.decisions } })
        break
      }
      case "replay.progress": {
        const x = d as Of<"replay.progress">, card = v(x.verifier)
        Object.assign(card, { status: later(card.status, "replaying"), progress: { step: Math.max(x.step, card.progress?.step ?? 0), total: x.total } })
        break
      }
      case "replay.paid": {
        // The Verifier emits "paid" with the settlement link; the Requester's 402 can land after it (D15).
        const x = d as Of<"replay.paid">, card = v(x.verifier), status = x.status === 402 ? "402" : "paid"
        Object.assign(card, { status: later(card.status, status), amount: x.amount, txUrl: e.txUrl ?? card.txUrl })
        break
      }
      case "verdict.signed": {
        const x = d as Of<"verdict.signed">
        Object.assign(v(x.verifier), { status: "verdict", outcome: x.outcome, evidenceHash: x.evidenceHash })
        break
      }
      case "settled": s.settled = { ...(d as object), txUrl: e.txUrl } as never; break
    }
  }
  // The wait is over once a later phase is reached: keep each card to the data of its current phase.
  for (const card of Object.values(s.verifiers)) if (card.status !== "waiting") delete card.waiting
  s.phase = s.settled ? "settled" : s.episode ? "verifying" : s.decisions.length ? "running"
    : s.stake ? "staked" : s.award ? "awarded" : s.sealedBids.length ? "bidding" : s.posted ? "posted" : "waiting"
  return s
}

/** What a Verifier's "not ready" reason means to a person; unknown reasons are shown as the Verifier worded them. */
export function waitLabel(reason: string): string {
  if (/^Galileo is not \d+ s past/.test(reason)) return "Waiting for 0G finality"
  if (/no Episode Submission yet/.test(reason)) return "Waiting for the Episode"
  if (/winner has not staked yet|no award for mission/.test(reason)) return "Waiting for the stake"
  return reason
}

/** "42 s", or "2 min 5 s" past a minute; null with no known end, "now" once it has passed. */
export function countdown(readyAt: number | undefined, nowMs: number): string | null {
  if (readyAt === undefined) return null
  const left = Math.ceil(readyAt - nowMs / 1000)
  if (left <= 0) return "now"
  return left < 60 ? `${left} s` : `${Math.floor(left / 60)} min ${left % 60} s`
}

/** The line a Verifier card or diagram node shows for its phase (null when there is nothing to add). `short` drops the wording. */
export function verifierNote(v: VerifierView, nowMs: number, short = false): string | null {
  if (v.status === "waiting" && v.waiting) {
    const left = countdown(v.waiting.readyAt, nowMs)
    if (short) return left ? `ready in ${left}` : "waiting"
    return left ? `${waitLabel(v.waiting.reason)} · ready in ${left}` : waitLabel(v.waiting.reason)
  }
  if (v.status === "replaying" && v.progress) return short ? `${v.progress.step} / ${v.progress.total}` : `Replaying ${v.progress.step} / ${v.progress.total}`
  return null
}

/** Verdicts with the same evidence hash, as "n of 3 agree". */
export function agreement(s: MissionState): { hash: string; count: number } | null {
  const counts = new Map<string, number>()
  for (const x of Object.values(s.verifiers)) if (x.evidenceHash) counts.set(x.evidenceHash, (counts.get(x.evidenceHash) ?? 0) + 1)
  const best = [...counts].sort((a, b) => b[1] - a[1])[0]
  return best && best[1] >= 2 ? { hash: best[0], count: best[1] } : null
}

/** Streams a Mission's events (history first, then live). EventSource reconnects by itself; duplicates are dropped by key. */
export function useMissionFeed(missionId: string | null, replay: boolean): MissionState {
  const [events, setEvents] = useState<DewoEvent[]>([])
  useEffect(() => {
    setEvents([])
    if (!missionId) return
    const es = new EventSource(`/api/events?missionId=${missionId}${replay ? "&replay=1" : ""}`)
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as DewoEvent
      setEvents((prev) => (prev.some((p) => eventKey(p) === eventKey(e)) ? prev : [...prev, e]))
    }
    return () => es.close()
  }, [missionId, replay])
  return useMemo(() => foldEvents(missionId ?? "", events), [missionId, events])
}
