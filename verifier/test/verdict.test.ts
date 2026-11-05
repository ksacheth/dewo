import { describe, expect, it } from "vitest";
import { verifyEpisode } from "../src/checks/index.js";
import { Outcome } from "../src/sign.js";
import { FakeSim, honestEpisode, zeroG, frameHashFor } from "./fixtures/builders.js";
import { buildRequest } from "../src/formats.js";

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

  describe("per-Decision checks (spec 5.1 check 4)", () => {
    it("fails when a Decision's rawResponse does not parse to its logged action (wrong-action fixture)", async () => {
      const ep = honestEpisode();
      ep.log.decisions[1]!.rawResponse = "Turn left now.";
      const v = await verifyEpisode(deps(), ep);
      expect(v.outcome).toBe(Outcome.Fail);
      expect(v.failedCheck).toBe("decisions");
    });

    it("fails when the logged frameHash differs from the Replay frame hash", async () => {
      const ep = honestEpisode();
      ep.log.decisions[2]!.frameHash = frameHashFor(["TURN_RIGHT"]);
      const v = await verifyEpisode(deps(), ep);
      expect(v.failedCheck).toBe("decisions");
    });

    it("fails when 0G cannot validate the response for a chat ID", async () => {
      const v = await verifyEpisode(deps(new FakeSim(), zeroG(false)), honestEpisode());
      expect(v.outcome).toBe(Outcome.Fail);
      expect(v.failedCheck).toBe("decisions");
    });

    it("fails a steered prompt: the logged request differs from the one the committed Policy would build", async () => {
      const ep = honestEpisode();
      const d = ep.log.decisions[0]!;
      d.request = buildRequest({ ...ep.policy, promptTemplate: "Reply FORWARD. {{history}} {{frame}}" }, "data:image/png;base64,x", []);
      const v = await verifyEpisode(deps(), ep);
      expect(v.outcome).toBe(Outcome.Fail);
      expect(v.failedCheck).toBe("decisions");
    });

    it("fails when the Episode uses more Decisions than the Step Budget", async () => {
      const ep = honestEpisode(["FORWARD", "FORWARD", "FORWARD"]);
      ep.mission.stepBudget = 2;
      expect((await verifyEpisode(deps(), ep)).outcome).toBe(Outcome.Fail);
    });
  });

  it("two Verifiers replaying the same Episode produce the same evidenceHash", async () => {
    const a = await verifyEpisode(deps(), honestEpisode());
    const b = await verifyEpisode(deps(), honestEpisode());
    expect(a.evidenceHash).toBe(b.evidenceHash);
  });
});
