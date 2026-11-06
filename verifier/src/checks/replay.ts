import { meetsLimits, type MissionLimits } from "@dewo/agents/formats";
import type { ReplayResult } from "../ports.js";

/** Check 3: the Replay ends at the goal within the Mission's limits (at most maxSteps Decisions and maxCollisions collisions). */
export const replayPasses = (r: ReplayResult, decisions: number, limits: MissionLimits): boolean =>
  meetsLimits({ atGoal: r.atGoal, collisions: r.collisions, decisions }, limits);
