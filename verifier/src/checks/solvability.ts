import { MAX_OPTIMAL_PATH_COST } from "@dewo/agents/formats";
import type { Course, SimPort } from "../ports.js";

/**
 * Check 2: the planner's Optimal Path Cost on the revealed Course.
 * Returns null (Invalid Course) when no path exists or the Path Allowance would exceed the Decision Cap.
 */
export async function optimalPathCostOf(sim: SimPort, course: Course): Promise<number | null> {
  const plan = await sim.plan(course);
  return plan.solvable && plan.optimalPathCost <= MAX_OPTIMAL_PATH_COST ? plan.optimalPathCost : null;
}
