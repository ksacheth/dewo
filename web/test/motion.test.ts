import { expect, it } from "vitest"
import { springStep } from "../src/motion"

it("the spring settles on its target without visible overshoot", () => {
  const b = { x: 0, y: 0, vx: 0, vy: 0 }
  let max = 0, frames = 0
  while (springStep(b, 100, 0, 1 / 60) && frames < 600) { max = Math.max(max, b.x); frames++ }
  expect(b.x).toBe(100)
  expect(max).toBeLessThan(100.5) // critically damped: at most a hair past the target
  expect(frames).toBeLessThan(60) // settles within about a second
})
