import { expect, it } from "vitest"
import { collides, pathFromActions } from "../src/pathing"

const start = { x: 1, y: 3, yaw: 0 }
const wall = [{ x: 1.7, y: 3, w: 0.2, h: 2 }]

it("a FORWARD blocked by the feed leaves the robot where it was", () => {
  const p = pathFromActions(start, ["FORWARD", "FORWARD"], { blocked: [false, true] })
  expect(p.map((q) => q.x)).toEqual([1, 1.5, 1.5])
})

it("without feed data a rover FORWARD is checked against the obstacles", () => {
  expect(collides(wall, start, { ...start, x: 1.5 })).toBe(true)
  const p = pathFromActions(start, ["FORWARD", "TURN_LEFT"], { obstacles: wall })
  expect(p[1]).toEqual(start)
  expect(p[2].yaw).toBeGreaterThan(0)
})

it("the arena edge blocks, and a free move goes through", () => {
  expect(collides([], { x: 0.3, y: 3, yaw: Math.PI }, { x: -0.2, y: 3, yaw: Math.PI })).toBe(true)
  expect(pathFromActions(start, ["FORWARD"], { obstacles: [] })[1].x).toBeCloseTo(1.5)
})
