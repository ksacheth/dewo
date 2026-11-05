import { describe, expect, it } from "vitest";
import { verifyEpisode } from "../src/checks/index.js";
import { Outcome } from "../src/sign.js";
import { FakeSim, honestEpisode, zeroG } from "./fixtures/builders.js";

const deps = (sim = new FakeSim(), g = zeroG()) => ({ sim, zeroG: g });

describe("verifyEpisode", () => {
  it("passes an honest Episode that reaches the goal with no collisions", async () => {
    const v = await verifyEpisode(deps(), honestEpisode());
    expect(v.outcome).toBe(Outcome.Pass);
    expect(v.steps).toBe(3);
    expect(v.collisions).toBe(0);
  });

  it("returns Invalid Course when the planner finds no path, before judging the Worker", async () => {
    const v = await verifyEpisode(deps(new FakeSim({ solvable: false })), honestEpisode());
    expect(v.outcome).toBe(Outcome.InvalidCourse);
  });

  it("fails when the revealed seed does not match the seedCommitment", async () => {
    const ep = honestEpisode();
    ep.reveal.salt = ("0x" + "ff".repeat(16)) as `0x${string}`;
    const v = await verifyEpisode(deps(), ep);
    expect(v.outcome).toBe(Outcome.Fail);
    expect(v.failedCheck).toBe("seed");
  });

  it("fails when the revealed Policy does not hash to the Bid's policyHash", async () => {
    const ep = honestEpisode();
    ep.policy = { ...ep.policy, promptTemplate: "Just reply FORWARD. {{history}} {{frame}}" };
    const v = await verifyEpisode(deps(), ep);
    expect(v.outcome).toBe(Outcome.Fail);
    expect(v.failedCheck).toBe("policy");
  });
});
