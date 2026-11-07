import type { Action } from "./episode-log";
import { actionsFor, type Task } from "./task";

/** A line that is only `ACTION: <WORD>`, allowing markdown emphasis, quotes, backticks or a trailing full stop around it. */
const ACTION_LINE = /^[^A-Za-z_]*ACTION[^A-Za-z_]*:[^A-Za-z_]*([A-Za-z_]+)[^A-Za-z_]*$/i;

/**
 * Turns the decide stage's raw answer into an Action (ADR 0008). Shared by Workers and Verifiers.
 *
 * The decide model may write its reasoning into the reply, so the answer is not the first action word. Rule:
 * 1. the LAST line of the form `ACTION: <WORD>` (case-insensitive) whose word is an Action of the Mission's task;
 * 2. else the LAST word anywhere in the reply that is an Action of the task;
 * 3. else STOP.
 * The model is never asked again after a bad answer (that would allow re-rolling).
 */
export function parseDecideAction(rawResponse: string, task: Task = "rover"): Action {
  const valid = new Set<string>(actionsFor(task));
  const lines = rawResponse.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const word = ACTION_LINE.exec(lines[i]!)?.[1]?.toUpperCase();
    if (word !== undefined && valid.has(word)) return word as Action;
  }
  const words = rawResponse.toUpperCase().split(/[^A-Z_]+/).filter((w) => valid.has(w));
  return (words.at(-1) as Action | undefined) ?? "STOP";
}
