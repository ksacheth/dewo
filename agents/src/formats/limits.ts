// Mission Limits shared by Requesters, Workers and Verifiers (docs/spec.md section 4.6, ADR 0006).
// The Requester sets them in createMission; everyone reads them from the escrow.
import type { Action } from "./episode-log";

export interface MissionLimits {
  /** The most Decisions an Episode may take (at least 1). Also the Worker's Episode loop bound and 0G spend bound. */
  maxSteps: number;
  /** The most collisions a Pass may have (0 or more). */
  maxCollisions: number;
}

/**
 * Protocol ceiling on maxSteps, the same as `MissionEscrow.MAX_STEPS`. It bounds what any Episode Log can make a Verifier replay
 * (a Decision takes seconds on 0G, so 200 already exceeds any realistic Episode window).
 */
export const MAX_STEPS = 200;

/** createMission stores maxCollisions as uint32. */
const UINT32_MAX = 0xffff_ffff;

const isWholeBetween = (value: number, min: number, max: number): boolean => Number.isInteger(value) && value >= min && value <= max;

/** Everything wrong with a pair of limits, as readable sentences; empty when createMission would accept them. */
export function limitsProblems(limits: MissionLimits): string[] {
  const rules = [
    ["maxSteps", limits.maxSteps, 1, MAX_STEPS],
    ["maxCollisions", limits.maxCollisions, 0, UINT32_MAX],
  ] as const;
  return rules
    .filter(([, value, min, max]) => !isWholeBetween(value, min, max))
    .map(([name, value, min, max]) => `${name} must be a whole number from ${min} to ${max}, got ${value}`);
}

/** The most Decisions a Verifier will replay for this Mission: its maxSteps, never above the protocol's MAX_STEPS. */
export const replayableSteps = (limits: MissionLimits): number => Math.min(limits.maxSteps, MAX_STEPS);

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
