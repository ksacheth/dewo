import { mkdtempSync, readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import type { DewoEvent } from "@dewo/board"
import { fakeRun } from "../scripts/fake-run"
import { agreement, countdown, foldEvents, verifierNote, waitLabel } from "../src/feed"

async function recordedFiles() {
  const dir = mkdtempSync(join(tmpdir(), "dewo-web-"))
  const id = await fakeRun({ dir, delayMs: 4 })
  const files = readdirSync(join(dir, id)).filter((f) => f.endsWith(".ndjson")).map((f) =>
    ({ file: f, events: readFileSync(join(dir, id, f), "utf8").trim().split("\n").map((l) => JSON.parse(l) as DewoEvent) }))
  return { id, files }
}

async function recorded() {
  const { id, files } = await recordedFiles()
  return { id, events: files.flatMap((f) => f.events).sort((a, b) => a.ts.localeCompare(b.ts)) }
}

it("plays a full recorded Mission to its final state", async () => {
  const { id, events } = await recorded()
  const s = foldEvents(id, events)
  expect(s.phase).toBe("settled")
  expect(s.sealedBids.map((b) => b.workerName)).toEqual(["Careful", "Cheap and Blind", "Gambler"])
  expect(s.revealed?.winner).toBe(s.award?.worker)
  expect(s.decisions).toHaveLength(15)
  expect(s.decisions.map((d) => d.step)).toEqual(Array.from({ length: 15 }, (_, i) => i))
  const verdicts = Object.values(s.verifiers).filter((v) => v.outcome === "Pass")
  expect(verdicts).toHaveLength(2)
  expect(agreement(s)).toMatchObject({ count: 2 })
  expect(s.settled).toMatchObject({ outcome: "Pass", txUrl: expect.stringContaining("hashscan.io") })
})

it("rebuilds the same state regardless of the order events arrive in", async () => {
  const { id, events } = await recorded()
  expect(foldEvents(id, [...events].reverse())).toEqual(foldEvents(id, events))
})

it("reports the phase as events arrive", async () => {
  const { id, events } = await recorded()
  const upTo = (t: string) => foldEvents(id, events.slice(0, events.findIndex((e) => e.type === t) + 1)).phase
  expect([upTo("mission.posted"), upTo("bid.sealed"), upTo("award.signed"), upTo("stake.deposited"), upTo("decision.made"), upTo("episode.submitted")])
    .toEqual(["posted", "bidding", "awarded", "staked", "running", "verifying"])
})

it("records each payment once, as the Verifier's paid event with its HashScan link (D15)", async () => {
  const { files } = await recordedFiles()
  const paid = files.flatMap(({ file, events }) => events
    .filter((e) => e.type === "replay.paid" && (e.data as { status: unknown }).status === "paid").map((e) => ({ file, txUrl: e.txUrl })))
  expect(paid).toEqual([1, 2, 3].map((n) => ({ file: `events.verifier-${n}.ndjson`, txUrl: expect.stringContaining("hashscan.io") })))
})

it("shows each Verifier's payment link from its paid event", async () => {
  const { id, events } = await recorded()
  const cards = Object.values(foldEvents(id, events).verifiers)
  expect(cards).toHaveLength(3)
  for (const c of cards) expect(c).toMatchObject({ amount: "50000", txUrl: expect.stringContaining("hashscan.io") })
})

it("never moves a Verifier card back: a 402 or paid event that lands late keeps the later state", () => {
  const verifier = "0x00000000000000000000000000000000000000a1"
  const txUrl = "https://hashscan.io/testnet/transaction/0.0.1@1.1"
  const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString()
  // The real order: the Verifier settles and signs, then the Requester reports the 402 it had to answer.
  const events = [
    { ts: at(1), missionId: "m", type: "replay.paid", data: { verifier, status: "paid", amount: "50000" }, txUrl },
    { ts: at(2), missionId: "m", type: "verdict.signed", data: { verifier, outcome: "Pass", evidenceHash: "0xe", arkivKey: "0xk" } },
    { ts: at(3), missionId: "m", type: "replay.paid", data: { verifier, status: 402, amount: "50000" } },
  ] as DewoEvent[]
  expect(foldEvents("m", events).verifiers[verifier]).toEqual({ status: "verdict", outcome: "Pass", evidenceHash: "0xe", amount: "50000", txUrl })
  expect(foldEvents("m", [events[0]!, events[2]!]).verifiers[verifier]).toMatchObject({ status: "paid", txUrl })
})

const V = "0x00000000000000000000000000000000000000b2"
const T0 = Date.UTC(2026, 0, 1)
const ev = (s: number, type: string, data: object, txUrl?: string) =>
  ({ ts: new Date(T0 + s * 1000).toISOString(), missionId: "m", type, data, ...(txUrl && { txUrl }) }) as DewoEvent
const card = (events: DewoEvent[]) => foldEvents("m", events).verifiers[V]

it("shows a waiting Verifier with its reason and end, then drops the wait once it replays", () => {
  const waiting = ev(1, "replay.waiting", { verifier: V, reason: "Galileo is not 120 s past 1100 yet", readyAt: 1220 })
  expect(card([waiting])).toEqual({ status: "waiting", waiting: { reason: "Galileo is not 120 s past 1100 yet", readyAt: 1220 } })
  expect(card([waiting, ev(2, "replay.waiting", { verifier: V, reason: "no Episode Submission yet" })])?.waiting).toEqual({ reason: "no Episode Submission yet" })
  const replaying = card([waiting, ev(2, "replay.started", { verifier: V, decisions: 40 })])
  expect(replaying).toEqual({ status: "replaying", progress: { step: 0, total: 40 } })
})

it("walks a Verifier through waiting, replaying k of N, paid and the verdict", () => {
  const events = [
    ev(1, "replay.waiting", { verifier: V, reason: "Galileo is not 120 s past 1100 yet", readyAt: 1220 }),
    ev(2, "replay.started", { verifier: V, decisions: 40 }),
    ev(3, "replay.progress", { verifier: V, step: 4, total: 40 }),
    ev(4, "replay.progress", { verifier: V, step: 12, total: 40 }),
  ]
  expect(card(events)).toEqual({ status: "replaying", progress: { step: 12, total: 40 } })
  const paid = [...events, ev(5, "replay.paid", { verifier: V, status: "paid", amount: "50000" }, "https://hashscan.io/x")]
  expect(card(paid)).toMatchObject({ status: "paid", amount: "50000" })
  expect(card([...paid, ev(6, "verdict.signed", { verifier: V, outcome: "Fail", evidenceHash: "0xe", arkivKey: "0xk" })])).toMatchObject({ status: "verdict", outcome: "Fail" })
})

it("keeps the later phase when progress or a wait arrives out of order, and the highest step", () => {
  const verdict = ev(5, "verdict.signed", { verifier: V, outcome: "Pass", evidenceHash: "0xe", arkivKey: "0xk" })
  const late = [verdict, ev(4, "replay.waiting", { verifier: V, reason: "x" }), ev(3, "replay.progress", { verifier: V, step: 8, total: 10 })]
  expect(card(late)).toMatchObject({ status: "verdict", outcome: "Pass" })
  expect(card(late)?.waiting).toBeUndefined()
  const steps = [ev(1, "replay.progress", { verifier: V, step: 8, total: 10 }), ev(2, "replay.progress", { verifier: V, step: 4, total: 10 })]
  expect(card(steps)?.progress).toEqual({ step: 8, total: 10 })
})

it("renders old logs without the new events exactly as before", async () => {
  const { id, events } = await recorded()
  const old = events.filter((e) => !e.type.startsWith("replay.") || e.type === "replay.paid")
  for (const c of Object.values(foldEvents(id, old).verifiers)) expect(c).not.toHaveProperty("waiting")
  expect(foldEvents(id, old)).toEqual(foldEvents(id, events))
})

it("words the wait and counts down to readyAt", () => {
  expect(waitLabel("Galileo is not 120 s past 1100 yet")).toBe("Waiting for 0G finality")
  expect(waitLabel("something else")).toBe("something else")
  expect(countdown(1042, 1000_000)).toBe("42 s")
  expect(countdown(1125, 1000_000)).toBe("2 min 5 s")
  expect(countdown(1000, 1000_000)).toBe("now")
  expect(countdown(undefined, 0)).toBeNull()
  const waiting = { status: "waiting", waiting: { reason: "Galileo is not 120 s past 1 yet", readyAt: 1042 } } as const
  expect(verifierNote(waiting, 1000_000)).toBe("Waiting for 0G finality · ready in 42 s")
  expect(verifierNote(waiting, 1000_000, true)).toBe("ready in 42 s")
  expect(verifierNote({ status: "replaying", progress: { step: 12, total: 40 } }, 0)).toBe("Replaying 12 / 40")
  expect(verifierNote({ status: "idle" }, 0)).toBeNull()
})
