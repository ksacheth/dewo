import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import type { DewoEvent } from "@dewo/board"
import { foldEvents } from "../src/feed"
import { RunView, SceneDescription } from "../src/panels/RunView"

const at = (n: number) => new Date(Date.UTC(2026, 10, 7, 12, 0, n)).toISOString()
const decision = (step: number, scene?: string): DewoEvent =>
  ({ missionId: "m1", ts: at(step), type: "decision.made", data: { step, frame: `m1/frames/${step}.png`, chatID: `chat-${step}`, action: "FORWARD", ...(scene ? { scene } : {}) } }) as DewoEvent

it("keeps the Scene Description of a two-stage Decision in the folded state", () => {
  const state = foldEvents("m1", [decision(0, "Pole: visible, centre, far."), decision(1)])
  expect(state.decisions[0]?.scene).toBe("Pole: visible, centre, far.")
  expect(state.decisions[1]?.scene).toBeUndefined()
})

it("renders the scene text in a collapsed, expandable block", () => {
  const html = renderToStaticMarkup(<SceneDescription step={0} scene="Pole: visible, left, near." />)
  expect(html).toContain("<details")
  expect(html).not.toContain(" open")
  expect(html).toContain("Scene description")
  expect(html).toContain("Pole: visible, left, near.")
})

it("shows the scene of the latest Decision in the Run view, and nothing for single-stage Decisions", () => {
  const withScene = renderToStaticMarkup(<RunView state={foldEvents("m1", [decision(0, "Box ahead, close.")])} />)
  expect(withScene).toContain("Box ahead, close.")
  const without = renderToStaticMarkup(<RunView state={foldEvents("m1", [decision(0)])} />)
  expect(without).not.toContain("Scene description")
})
