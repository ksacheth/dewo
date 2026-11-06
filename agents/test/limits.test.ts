import { describe, expect, it } from "vitest";
import { limitsProblems, meetsLimits, movingSteps } from "../src/formats";

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

  it("accepts the limits createMission accepts: whole numbers, maxSteps at least 1, both within uint32", () => {
    expect(limitsProblems({ maxSteps: 1, maxCollisions: 0 })).toEqual([]);
    expect(limitsProblems({ maxSteps: 0xffff_ffff, maxCollisions: 0xffff_ffff })).toEqual([]);
    expect(limitsProblems({ maxSteps: 0, maxCollisions: 0 })).toHaveLength(1);
    expect(limitsProblems({ maxSteps: 2.5, maxCollisions: -1 })).toHaveLength(2);
    expect(limitsProblems({ maxSteps: 0x1_0000_0000, maxCollisions: 0 })).toHaveLength(1);
  });
});
