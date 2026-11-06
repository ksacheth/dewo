import { describe, expect, it } from "vitest";
import { MAX_STEPS, limitsProblems, meetsLimits, movingSteps, replayableSteps } from "../src/formats";

describe("Mission Limits (ADR 0006)", () => {
  it("counts every turn as a step but not STOP", () => {
    expect(movingSteps(["FORWARD", "TURN_LEFT", "TURN_LEFT", "FORWARD", "STOP"])).toBe(4);
  });

  it("a Pass needs the goal, at most maxSteps Decisions and at most maxCollisions collisions", () => {
    const limits = { maxSteps: 10, maxCollisions: 1 };
    expect(meetsLimits({ atGoal: true, decisions: 10, collisions: 1 }, limits)).toBe(true);
    expect(meetsLimits({ atGoal: false, decisions: 5, collisions: 0 }, limits)).toBe(false);
    expect(meetsLimits({ atGoal: true, decisions: 11, collisions: 0 }, limits)).toBe(false);
    expect(meetsLimits({ atGoal: true, decisions: 5, collisions: 2 }, limits)).toBe(false);
  });

  it("accepts the limits createMission accepts: whole numbers, maxSteps from 1 to MAX_STEPS, maxCollisions within uint32", () => {
    expect(MAX_STEPS).toBe(200);
    expect(limitsProblems({ maxSteps: 1, maxCollisions: 0 })).toEqual([]);
    expect(limitsProblems({ maxSteps: MAX_STEPS, maxCollisions: 0xffff_ffff })).toEqual([]);
    expect(limitsProblems({ maxSteps: 0, maxCollisions: 0 })).toHaveLength(1);
    expect(limitsProblems({ maxSteps: MAX_STEPS + 1, maxCollisions: 0 })).toEqual([`maxSteps must be a whole number from 1 to 200, got 201`]);
    expect(limitsProblems({ maxSteps: 2.5, maxCollisions: -1 })).toHaveLength(2);
  });

  it("never lets a Mission make a Verifier replay more than MAX_STEPS Decisions", () => {
    expect(replayableSteps({ maxSteps: 40, maxCollisions: 0 })).toBe(40);
    expect(replayableSteps({ maxSteps: 4_000_000_000, maxCollisions: 0 })).toBe(MAX_STEPS);
  });
});
