// The spectator view's timeline, pure so it can be tested. A rover.moved event carries the images of one move;
// move 0 is the start pose and move k (k >= 1) is where Decision k-1 took the robot (agents/src/shared/overview.ts).
import type { MissionState } from "./feed"

export type Move = MissionState["moves"][number]
export type Decision = MissionState["decisions"][number]
/** One image of the arena, with the move it belongs to. */
export type Shot = { image: string; move: number; collision: boolean; atGoal: boolean }

/** Every arena image in play order. */
export const shotsOf = (moves: Move[]): Shot[] =>
  moves.flatMap((m) => m.images.map((image) => ({ image, move: m.step, collision: m.collision, atGoal: m.atGoal })))

/** The last image of each move, by step: the pose the next Decision was made from. */
export const lastShotOf = (moves: Move[]): Shot | null => shotsOf(moves.slice(-1)).at(-1) ?? null

/** The Decision behind a move: move k was made by Decision k-1. The start (move 0) shows the first frame, with no Action yet. */
export function decisionForMove(decisions: Decision[], move: number): { decision: Decision | undefined; start: boolean } {
  return { decision: decisions.find((d) => d.step === Math.max(0, move - 1)), start: move === 0 }
}

/** Colour of the bar under the onboard frame, as in sim/overview/demo.py: green on the goal, red on a blocked move. */
export const toneOf = (s: { collision: boolean; atGoal: boolean } | null | undefined): "goal" | "hit" | undefined =>
  s?.atGoal ? "goal" : s?.collision ? "hit" : undefined

/** Decision steps are 0-based on the wire (decision.made.step); people count from 1. */
export const decisionNumber = (step: number) => step + 1

export const robotName = (task: string | undefined) => (task === "drone" ? "Drone" : "Rover")
export const goalText = (task: string | undefined) => (task === "drone" ? "Flew through the hoop" : "Reached the charger")
