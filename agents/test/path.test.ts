import { describe, expect, it } from "vitest";
import { DECISION_CAP, MAX_OPTIMAL_PATH_COST, pathAllowance, pathCost, pathQuality } from "../src/formats";

describe("pass rule", () => {
  it("counts every turn but not STOP", () => {
    expect(pathCost(["FORWARD", "TURN_LEFT", "TURN_LEFT", "FORWARD", "STOP"])).toBe(4);
  });

  it("allows twice the optimal Path Cost plus two", () => {
    expect(pathAllowance(10)).toBe(22);
  });

  it("the largest valid optimal path still fits under the Decision Cap", () => {
    expect(MAX_OPTIMAL_PATH_COST).toBe(29);
    expect(pathAllowance(MAX_OPTIMAL_PATH_COST)).toBe(DECISION_CAP);
  });

  it("Path Quality is optimal / actual, capped at 1", () => {
    expect(pathQuality(10, 20)).toBe(0.5);
    expect(pathQuality(10, 10)).toBe(1);
    expect(pathQuality(10, 0)).toBe(0);
  });
});
