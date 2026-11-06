import { expect, it } from "vitest"
import { pathCostOf, pathFromActions } from "../src/pathing"
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

it("counts Path Cost as moving Actions, so every turn counts and STOP does not", () => {
  expect(pathCostOf(["FORWARD", "TURN_LEFT", "TURN_RIGHT", "STOP"])).toBe(3)
})
