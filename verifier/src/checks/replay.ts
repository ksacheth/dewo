import type { ReplayResult } from "../ports.js";

/** Check 5: Replay ends at the goal, with zero collisions, within the Step Budget. */
export const replayPasses = (r: ReplayResult, stepBudget: number): boolean =>
  r.atGoal && r.collisions === 0 && r.steps <= stepBudget;
