import type { Course, SimPort } from "../ports.js";

/** Check 2: a deterministic planner must find a path within the Step Budget, else Invalid Course. */
export async function isSolvable(sim: SimPort, course: Course, stepBudget: number): Promise<boolean> {
  return (await sim.plan(course, stepBudget)).solvable;
}
