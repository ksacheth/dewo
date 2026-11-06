import { expect, it } from "vitest"
import { bidStake, reliability } from "../../board/src/scoring"
import { onboardProfile } from "../server/events"
import { pathFromActions } from "../src/pathing"
import { stageOf } from "../src/stages"

it("maps every Mission phase to the stage the page shows", () => {
  expect(["waiting", "posted", "bidding", "awarded", "staked", "running", "verifying", "settled"].map((p) => stageOf(p as never)))
    .toEqual(["bidding", "bidding", "bidding", "awarded", "awarded", "running", "verifying", "result"])
})

it("dead-reckons the route: FORWARD is 0.5 m, turns are 30 degrees, STOP ends it", () => {
  const start = { x: 1, y: 1, yaw: 0 }
  const path = pathFromActions(start, ["FORWARD", "TURN_LEFT", "FORWARD", "STOP", "FORWARD"])
  expect(path).toHaveLength(4)
  expect(path[1]).toEqual({ x: 1.5, y: 1, yaw: 0 })
  expect(path[3].x).toBeCloseTo(1.5 + 0.5 * Math.cos(Math.PI / 6))
  expect(path[3].y).toBeCloseTo(1 + 0.5 * Math.sin(Math.PI / 6))
})

it("onboarding shows a new Worker the starting Reliability and its Bid Stake, and a Verifier its trust", async () => {
  const trusted = ["0x00000000000000000000000000000000000000e1"]
  const board = { trustedVerifiers: () => trusted, leaderboard: async () => [], reliability, bidStake }
  const fresh = await onboardProfile("0x00000000000000000000000000000000000000c9", "worker", board)
  expect(fresh.worker.reliability).toBeCloseTo(2 / 3) // the prior (2 + 0) / (3 + 0)
  expect(fresh.worker.stakeFraction).toBeCloseTo(1 / 6, 5) // (1 - R) / 2 of the Max Bounty
  expect(fresh.worker).toMatchObject({ xp: 0, level: 0, missions: 0 })
  expect(fresh.verifier.trusted).toBe(false)
  expect((await onboardProfile(trusted[0], "verifier", board)).verifier.trusted).toBe(true)
})
