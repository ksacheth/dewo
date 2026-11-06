import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { DewoEvent } from "@dewo/board"
import { fakeRun } from "../scripts/fake-run"
import { decisionForMove, decisionNumber, lastShotOf, shotsOf, toneOf } from "../src/arena"
import { foldEvents } from "../src/feed"

const move = (step: number, n: number, extra: Partial<{ collision: boolean; atGoal: boolean }> = {}) =>
  ({ step, images: Array.from({ length: n }, (_, i) => `m${step}_${i}.png`), collision: false, atGoal: false, ...extra })
const decision = (step: number, action: string) => ({ step, frame: `f${step}.png`, chatID: `c${step}`, action, ts: String(step) })

describe("arena timeline", () => {
  it("plays every image of every move in order", () => {
    const shots = shotsOf([move(0, 2), move(1, 3, { collision: true })])
    expect(shots.map((s) => s.image)).toEqual(["m0_0.png", "m0_1.png", "m1_0.png", "m1_1.png", "m1_2.png"])
    expect(shots.map((s) => s.move)).toEqual([0, 0, 1, 1, 1])
    expect(lastShotOf([move(0, 2), move(1, 3)])?.image).toBe("m1_2.png")
    expect(lastShotOf([])).toBeNull()
  })

  it("pairs move k with the Decision k-1 that made it, and the start with the first frame", () => {
    const ds = [decision(0, "ASCEND"), decision(1, "FORWARD"), decision(2, "TURN_LEFT")]
    expect(decisionForMove(ds, 0)).toEqual({ decision: ds[0], start: true })
    expect(decisionForMove(ds, 1)).toEqual({ decision: ds[0], start: false })
    expect(decisionForMove(ds, 3)).toEqual({ decision: ds[2], start: false })
  })

  it("colours the bar like the demo reels and counts Decisions from 1", () => {
    expect(toneOf({ collision: false, atGoal: true })).toBe("goal")
    expect(toneOf({ collision: true, atGoal: false })).toBe("hit")
    expect(toneOf({ collision: false, atGoal: false })).toBeUndefined()
    expect(decisionNumber(0)).toBe(1)
  })
})

it("fake-run plays a demo reel as decision.made and rover.moved events", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dewo-reel-"))
  const reelDir = join(dir, "_reels", "drone-hard")
  mkdirSync(reelDir, { recursive: true })
  const course = { task: "drone", start: { x: 1, y: 1, yaw: 0, z: 0.5 }, goal: { x: 4, y: 4, z: 1.5, r: 0.4 }, obstacles: [] }
  writeFileSync(join(reelDir, "course.json"), JSON.stringify(course))
  writeFileSync(join(reelDir, "reel.json"), JSON.stringify({
    task: "drone", difficulty: "hard",
    decisions: [{ step: 0, frame: "onboard/000.png", action: "ASCEND" }, { step: 1, frame: "onboard/001.png", action: "FORWARD" }],
    moves: [move(0, 2), move(1, 2), move(2, 3, { atGoal: true })],
  }))
  const id = await fakeRun({ dir, delayMs: 2, task: "drone" })
  const events = readdirSync(join(dir, id)).filter((f) => f.endsWith(".ndjson"))
    .flatMap((f) => readFileSync(join(dir, id, f), "utf8").trim().split("\n").map((l) => JSON.parse(l) as DewoEvent))
  const s = foldEvents(id, events)
  expect(s.posted).toMatchObject({ task: "drone", difficultyClass: "hard" })
  expect(s.decisions.map((d) => [d.step, d.action, d.frame])).toEqual([[0, "ASCEND", "_reels/drone-hard/onboard/000.png"], [1, "FORWARD", "_reels/drone-hard/onboard/001.png"]])
  expect(s.moves.map((m) => m.step)).toEqual([0, 1, 2])
  expect(s.moves[2]).toMatchObject({ atGoal: true, images: ["_reels/drone-hard/m2_0.png", "_reels/drone-hard/m2_1.png", "_reels/drone-hard/m2_2.png"] })
  expect(s.episode?.decisionCount).toBe(2)
  expect(JSON.parse(readFileSync(join(dir, id, "course.json"), "utf8"))).toEqual(course)
})
