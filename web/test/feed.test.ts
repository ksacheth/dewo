import { mkdtempSync, readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import type { DewoEvent } from "@dewo/board"
import { fakeRun } from "../scripts/fake-run"
import { agreement, foldEvents } from "../src/feed"

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
