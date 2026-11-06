// Pass rule constants shared by Workers and Verifiers (docs/spec.md section 4.6, ADR 0003).
import type { Action } from "./episode-log";

/** Maximum Decisions in any Episode, for every Mission. */
export const DECISION_CAP = 60;

/** Number of moving Actions; every turn counts, STOP does not. */
export function pathCost(actions: readonly Action[]): number {
  return actions.filter((action) => action !== "STOP").length;
}

/** The most Path Cost a Pass may have on a Course whose shortest path costs `optimalPathCost`. */
export function pathAllowance(optimalPathCost: number): number {
  return 2 * optimalPathCost + 2;
}

/** Largest Optimal Path Cost whose Path Allowance still fits under the Decision Cap; above it, Invalid Course. */
export const MAX_OPTIMAL_PATH_COST = (DECISION_CAP - 2) / 2;

/** How close the Episode came to the shortest path, from 0 to 1. */
export function pathQuality(optimalPathCost: number, cost: number): number {
  if (cost <= 0) return 0;
  return Math.min(1, optimalPathCost / cost);
}
