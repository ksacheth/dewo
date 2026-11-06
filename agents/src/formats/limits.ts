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

/** Everything wrong with a pair of limits, as readable sentences; empty when createMission would accept them. */
export function limitsProblems(limits: MissionLimits): string[] {
  const problems: string[] = [];
  const { maxSteps, maxCollisions } = limits;
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > UINT32_MAX) {
    problems.push(`maxSteps must be a whole number from 1 to ${UINT32_MAX}, got ${maxSteps}`);
  }
  if (!Number.isInteger(maxCollisions) || maxCollisions < 0 || maxCollisions > UINT32_MAX) {
    problems.push(`maxCollisions must be a whole number from 0 to ${UINT32_MAX}, got ${maxCollisions}`);
  }
  return problems;
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
