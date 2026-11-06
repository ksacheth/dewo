import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { reliability } from "../src/scoring.js";
import { Outcome } from "../src/sign.js";
import type { VerdictRecord } from "../src/ports.js";

const W = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const v = (outcome: Outcome, pathQuality: number, timestamp = 0): VerdictRecord => ({ worker: W, outcome, pathQuality, timestamp });

describe("reliability (spec 4.1: each Pass counts 0.5 + 0.5 x Path Quality)", () => {
  it("starts a new Worker at 2/3", () => {
    expect(reliability([])).toBeCloseTo(2 / 3);
  });

  it("counts a clean Pass as a full pass: (2 + 1) / (3 + 1)", () => {
    expect(reliability([v(Outcome.Pass, 1)])).toBeCloseTo(3 / 4);
  });

  it("counts a Pass with Path Quality 0.5 as 0.75 of a pass", () => {
    expect(reliability([v(Outcome.Pass, 0.5)])).toBeCloseTo(2.75 / 4);
  });

  it("raises Reliability less for a sloppy Pass than a clean one, but more than a Fail", () => {
    const sloppy = reliability([v(Outcome.Pass, 0.2)]);
    expect(sloppy).toBeLessThan(reliability([v(Outcome.Pass, 1)]));
    expect(sloppy).toBeGreaterThan(reliability([v(Outcome.Fail, 0)]));
  });

  it("ignores Path Quality on a Fail and excludes Invalid Course and No Seed Release", () => {
    expect(reliability([v(Outcome.Fail, 1)])).toBeCloseTo(2 / 4);
    expect(reliability([v(Outcome.InvalidCourse, 1), v(Outcome.NoSeedRelease, 1)])).toBeCloseTo(2 / 3);
  });

  it("weights the most recent Verdict most (lambda = 0.9)", () => {
    const r = reliability([v(Outcome.Pass, 1, 1), v(Outcome.Fail, 0, 0)]);
    expect(r).toBeCloseTo((2 + 1) / (3 + 1 + 0.9));
  });
});
