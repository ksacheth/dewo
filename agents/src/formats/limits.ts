// Mission Limits shared by Requesters, Workers and Verifiers (docs/spec.md section 4.6, ADR 0006).
// The Requester sets them in createMission; everyone reads them from the escrow.
import type { Action } from "./episode-log";

export interface MissionLimits {
  /** The most Decisions an Episode may take (at least 1). Also the Worker's Episode loop bound and 0G spend bound. */
  maxSteps: number;
  /** The most collisions a Pass may have (0 or more). */
  maxCollisions: number;
}

/** createMission stores both limits as uint32. */
const UINT32_MAX = 0xffff_ffff;

/** A whole number from `min` to the uint32 maximum. */
const isUint32From = (value: number, min: number): boolean => Number.isInteger(value) && value >= min && value <= UINT32_MAX;

/** Everything wrong with a pair of limits, as readable sentences; empty when createMission would accept them. */
export function limitsProblems(limits: MissionLimits): string[] {
  const rules = [
    ["maxSteps", limits.maxSteps, 1],
    ["maxCollisions", limits.maxCollisions, 0],
  ] as const;
  return rules
    .filter(([, value, min]) => !isUint32From(value, min))
    .map(([name, value, min]) => `${name} must be a whole number from ${min} to ${UINT32_MAX}, got ${value}`);
}

/** Moving Actions, every Decision except STOP: `steps` in `sim replay` output and in a Verdict. */
export function movingSteps(actions: readonly Action[]): number {
  return actions.filter((action) => action !== "STOP").length;
}

/** What a Replay measured, as the Pass rule needs it. */
export interface ReplayMeasure {
  /** Decisions in the Episode Log. */
  decisions: number;
  collisions: number;
  atGoal: boolean;
}

/** The Pass rule on a Replay: the goal, at most maxSteps Decisions and at most maxCollisions collisions. */
export function meetsLimits(replay: ReplayMeasure, limits: MissionLimits): boolean {
  return replay.atGoal && replay.decisions <= limits.maxSteps && replay.collisions <= limits.maxCollisions;
}
