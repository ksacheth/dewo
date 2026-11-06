// One pure fold over the I8 event stream. The UI never invents state: if no event said it, it isn't shown.
import { useEffect, useMemo, useState } from "react"
import type { DewoEvent, EventData } from "@dewo/board"

type Of<T extends keyof EventData> = EventData[T]
export type VerifierView = { status: "idle" | "402" | "paid" | "verdict"; outcome?: string; evidenceHash?: string; txUrl?: string; amount?: string }
export type MissionState = {
  missionId: string
  posted?: Of<"mission.posted">
  sealedBids: Of<"bid.sealed">[]
  revealed?: Of<"bids.revealed">
  award?: Of<"award.signed"> & { txUrl?: string }
  stake?: Of<"stake.deposited"> & { txUrl?: string }
  decisions: (Of<"decision.made"> & { ts: string })[]
  episode?: Of<"episode.submitted"> & { txUrl?: string }
  verifiers: Record<string, VerifierView>
  settled?: Of<"settled"> & { txUrl?: string }
  phase: "waiting" | "posted" | "bidding" | "awarded" | "staked" | "running" | "verifying" | "settled"
}

const RANK: Record<VerifierView["status"], number> = { idle: 0, "402": 1, paid: 2, verdict: 3 }
/** A Verifier card only moves forward: events from different processes may arrive out of order. */
const later = (a: VerifierView["status"], b: VerifierView["status"]) => (RANK[b] > RANK[a] ? b : a)

export const eventKey = (e: DewoEvent) => `${e.ts}|${e.type}|${JSON.stringify(e.data)}`

export function foldEvents(missionId: string, events: DewoEvent[]): MissionState {
  const s: MissionState = { missionId, sealedBids: [], decisions: [], verifiers: {}, phase: "waiting" }
  const v = (addr: string) => (s.verifiers[addr] ??= { status: "idle" })
  // Stable sort: events with the same ts keep arrival order, so file timing doesn't matter.
  for (const e of [...events].sort((a, b) => a.ts.localeCompare(b.ts))) {
    const d = e.data as never
    switch (e.type) {
      case "mission.posted": s.posted = d; break
      case "bid.sealed": s.sealedBids.push(d); break
      case "bids.revealed": s.revealed = d; break
      case "award.signed": s.award = { ...(d as object), txUrl: e.txUrl } as never; break
      case "stake.deposited": s.stake = { ...(d as object), txUrl: e.txUrl } as never; break
      case "decision.made": s.decisions.push({ ...(d as object), ts: e.ts } as never); break
      case "episode.submitted": s.episode = { ...(d as object), txUrl: e.txUrl } as never; break
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
  s.phase = s.settled ? "settled" : s.episode ? "verifying" : s.decisions.length ? "running"
    : s.stake ? "staked" : s.award ? "awarded" : s.sealedBids.length ? "bidding" : s.posted ? "posted" : "waiting"
  return s
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
