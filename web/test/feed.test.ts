import { mkdtempSync, readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import type { DewoEvent } from "@dewo/board"
import { fakeRun } from "../scripts/fake-run"
import { agreement, foldEvents } from "../src/feed"

async function recorded() {
  const dir = mkdtempSync(join(tmpdir(), "dewo-web-"))
  const id = await fakeRun({ dir, delayMs: 4 })
  const events = readdirSync(join(dir, id)).filter((f) => f.endsWith(".ndjson")).flatMap((f) =>
    readFileSync(join(dir, id, f), "utf8").trim().split("\n").map((l) => JSON.parse(l) as DewoEvent))
  return { id, events: events.sort((a, b) => a.ts.localeCompare(b.ts)) }
}

it("plays a full recorded Mission to its final state", async () => {
  const { id, events } = await recorded()
  const s = foldEvents(id, events)
  expect(s.phase).toBe("settled")
  expect(s.sealedBids.map((b) => b.workerName)).toEqual(["Careful", "Cheap and Blind", "Gambler"])
  expect(s.revealed?.winner).toBe(s.award?.worker)
  expect(s.decisions).toHaveLength(15)
  expect(s.decisions.map((d) => d.step)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1))
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
