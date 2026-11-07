import type { Action } from "./episode-log";
import { actionsFor, type Task } from "./task";

/**
 * Turns a model's raw answer into an Action. Shared by Workers and Verifiers,
 * so both sides always agree on what the robot did.
 *
 * Rule: upper-case the text, split it into words, and take the last word that
 * is exactly one of the Actions of the Mission's task (a rover has no ASCEND or
 * DESCEND). If none is found, the Action is STOP. Last, not first: a Policy may
 * let the model reason before it answers, and the conclusion comes at the end.
 * The model is never asked again after a bad answer (that would allow re-rolling).
 */
export function parseAction(rawResponse: string, task: Task = "rover"): Action {
  const valid = new Set<string>(actionsFor(task));
  const words = rawResponse.toUpperCase().split(/[^A-Z_]+/);
  const match = words.reverse().find((word) => valid.has(word)); // findLast needs ES2023 lib
  return (match as Action | undefined) ?? "STOP";
}
