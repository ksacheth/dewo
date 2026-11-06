import { ACTIONS, type Action } from "./episode-log";

const VALID = new Set<string>(ACTIONS);

/**
 * Turns a model's raw answer into an Action. Shared by Workers and Verifiers,
 * so both sides always agree on what the robot did.
 *
 * Rule: upper-case the text, split it into words, and take the first word that
 * is exactly one of the Actions. If none is found, the Action is STOP.
 * The model is never asked again after a bad answer (that would allow re-rolling).
 */
export function parseAction(rawResponse: string): Action {
  const words = rawResponse.toUpperCase().split(/[^A-Z_]+/);
  const match = words.find((word) => VALID.has(word));
  return (match as Action | undefined) ?? "STOP";
}
