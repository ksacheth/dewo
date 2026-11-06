import { pathAllowance } from "@dewo/agents/formats";
import type { ReplayResult } from "../ports.js";

/** Check 5: Replay ends at the goal, with zero collisions, within the Path Allowance. The Decision Cap is checked on the log itself. */
export const replayPasses = (r: ReplayResult, pathCost: number, optimalPathCost: number): boolean =>
  r.atGoal && r.collisions === 0 && pathCost <= pathAllowance(optimalPathCost);
