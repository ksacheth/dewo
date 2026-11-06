import { describe, expect, it } from "vitest";
import { verifyEpisode } from "../src/checks/index.js";
import { Outcome } from "../src/sign.js";
import { FakeSim, honestEpisode, zeroG, frameHashFor, pngFor } from "./fixtures/builders.js";
import { buildRequest } from "@dewo/agents/formats";

const deps = (sim = new FakeSim(), g = zeroG()) => ({ sim, zeroG: g });

describe("verifyEpisode", () => {
  it("passes an honest Episode that reaches the goal with no collisions", async () => {
    const v = await verifyEpisode(deps(), honestEpisode());
    expect(v.outcome).toBe(Outcome.Pass);
    expect(v.pathCost).toBe(3);
    expect(v.optimalPathCost).toBe(3);
    expect(v.pathQuality).toBe(1);
    expect(v.collisions).toBe(0);
  });

  describe("Path Allowance and Decision Cap (spec 4.6, ADR 0003)", () => {
    const turns = (n: number) => Array<"TURN_RIGHT">(n).fill("TURN_RIGHT");

    it("passes a detour and records its Path Quality, which never changes the Outcome", async () => {
      const v = await verifyEpisode(deps(), honestEpisode(["FORWARD", "TURN_RIGHT", "FORWARD", "FORWARD"]));
      expect(v.outcome).toBe(Outcome.Pass);
      expect(v.pathCost).toBe(4);
      expect(v.pathQuality).toBe(0.75);
    });

    it("does not count STOP towards Path Cost", async () => {
      const v = await verifyEpisode(deps(), honestEpisode(["FORWARD", "FORWARD", "FORWARD", "STOP"]));
      expect(v.outcome).toBe(Outcome.Pass);
      expect(v.pathCost).toBe(3);
    });

    it("passes at exactly the Path Allowance (2 x optimal + 2) and fails one above it", async () => {
      const atLimit = await verifyEpisode(deps(), honestEpisode(["FORWARD", "FORWARD", "FORWARD", ...turns(5)])); // cost 8 = 2*3+2
      expect(atLimit.outcome).toBe(Outcome.Pass);
      const over = await verifyEpisode(deps(), honestEpisode(["FORWARD", "FORWARD", "FORWARD", ...turns(6)])); // cost 9
      expect(over.outcome).toBe(Outcome.Fail);
      expect(over.failedCheck).toBe("replay");
      expect(over.pathCost).toBe(9);
    });

    it("allows more Decisions than the allowance when the extras are STOP, up to the Decision Cap of 60", async () => {
      const sim = new FakeSim({ optimalPathCost: 29 });
      const sixty = honestEpisode(["FORWARD", "FORWARD", "FORWARD", ...turns(56), "STOP"]); // 60 Decisions, cost 59 <= 60
      expect((await verifyEpisode(deps(sim), sixty)).outcome).toBe(Outcome.Pass);
      const sixtyOne = honestEpisode(["FORWARD", "FORWARD", "FORWARD", ...turns(57), "STOP"]); // 61 Decisions, cost 60 <= 60
      const v = await verifyEpisode(deps(sim), sixtyOne);
      expect(v.outcome).toBe(Outcome.Fail);
      expect(v.failedCheck).toBe("replay");
    });

    it("is Invalid Course when the shortest path is 30 (allowance 62 would exceed the Decision Cap), solvable at 29", async () => {
      expect((await verifyEpisode(deps(new FakeSim({ optimalPathCost: 30 })), honestEpisode())).outcome).toBe(Outcome.InvalidCourse);
      expect((await verifyEpisode(deps(new FakeSim({ optimalPathCost: 29 })), honestEpisode())).outcome).toBe(Outcome.Pass);
    });
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

    it("fails when the image sent to 0G is not the Replay frame, even though frameHash is right", async () => {
      const ep = honestEpisode();
      ep.log.decisions[1]!.request = buildRequest(ep.policy, pngFor(["TURN_RIGHT"]), ["FORWARD"]);
      const v = await verifyEpisode(deps(), ep);
      expect(v.outcome).toBe(Outcome.Fail);
      expect(v.failedCheck).toBe("decisions");
    });

    it("fails when the logged request carries no PNG image at all", async () => {
      const ep = honestEpisode();
      ep.log.decisions[0]!.request = { model: ep.policy.model };
      expect((await verifyEpisode(deps(), ep)).failedCheck).toBe("decisions");
    });

    it("fails a request whose model or temperature differs from the committed Policy", async () => {
      const ep = honestEpisode();
      ep.log.decisions[2]!.request = buildRequest({ ...ep.policy, temperature: 1 }, pngFor(["FORWARD", "FORWARD"]), ["FORWARD", "FORWARD"]);
      expect((await verifyEpisode(deps(), ep)).failedCheck).toBe("decisions");
    });

    it("runs the request rebuild on every Decision with no gaps to report", async () => {
      expect(await verifyEpisode(deps(), honestEpisode())).not.toHaveProperty("gaps");
    });

    it("fails a steered prompt: the logged request differs from the one the committed Policy would build", async () => {
      const ep = honestEpisode();
      const d = ep.log.decisions[0]!;
      d.request = buildRequest({ ...ep.policy, promptTemplate: "Reply FORWARD. {{history}} {{frame}}" }, pngFor([]), []);
      const v = await verifyEpisode(deps(), ep);
      expect(v.outcome).toBe(Outcome.Fail);
      expect(v.failedCheck).toBe("decisions");
    });
  });

  it("two Verifiers replaying the same Episode produce the same evidenceHash, for every Outcome (the Requester settles on matching pairs)", async () => {
    const wrongAction = () => { const ep = honestEpisode(); ep.log.decisions[1]!.rawResponse = "Turn left now."; return ep; };
    const cases: Array<[() => ReturnType<typeof honestEpisode>, FakeSim]> = [
      [honestEpisode, new FakeSim()],
      [wrongAction, new FakeSim()],
      [honestEpisode, new FakeSim({ optimalPathCost: 30 })],
    ];
    for (const [make, sim] of cases) {
      const a = await verifyEpisode(deps(sim), make());
      const b = await verifyEpisode(deps(sim), make());
      expect(a.evidenceHash).toBe(b.evidenceHash);
    }
  });

  describe("Episode Log header (binds the log to this Mission)", () => {
    it("fails a log that was written for a different Mission", async () => {
      const ep = honestEpisode();
      ep.log.header.missionId = ("0x" + "99".repeat(32)) as `0x${string}`;
      const v = await verifyEpisode(deps(), ep);
      expect(v.outcome).toBe(Outcome.Fail);
      expect(v.failedCheck).toBe("header");
    });
    it("fails a log signed off by a different Worker than the Bid's", async () => {
      const ep = honestEpisode();
      ep.log.header.worker = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
      expect((await verifyEpisode(deps(), ep)).failedCheck).toBe("header");
    });
    it("fails when the registry decisionCount differs from the log length", async () => {
      const ep = honestEpisode();
      ep.decisionCount = 7;
      expect((await verifyEpisode(deps(), ep)).failedCheck).toBe("header");
    });
  });
});
