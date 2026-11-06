import { describe, expect, it } from "vitest";
import { SimInputError } from "../src/adapters/sim-cli.js";
import { verifyEpisode, type EpisodeInput } from "../src/checks/index.js";
import { NotJson } from "../src/ports.js";
import { Outcome } from "../src/sign.js";
import { FakeSim, honestEpisode, zeroG, frameHashFor, pngFor, POLICY, ROUTER_POLICY } from "./fixtures/builders.js";
import { buildRequest, policyHash, type Policy } from "@dewo/agents/formats";

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

  describe("a log the Worker wrote badly is a Fail, never an exception", () => {
    it("fails a Decision that names an Action the sim does not know", async () => {
      const ep = honestEpisode();
      (ep.log.decisions[0] as { action: string }).action = "JUMP";
      expect((await verifyEpisode(deps(), ep)).failedCheck).toBe("header");
    });
    it("fails a log whose Decisions are missing fields", async () => {
      const ep = honestEpisode();
      delete (ep.log.decisions[1] as Partial<(typeof ep.log.decisions)[number]>).frameHash;
      expect((await verifyEpisode(deps(), ep)).outcome).toBe(Outcome.Fail);
    });
    it("fails when the sim itself rejects the Action list", async () => {
      const sim = new FakeSim();
      sim.replay = async () => { throw new SimInputError("unknown action"); };
      const v = await verifyEpisode(deps(sim), honestEpisode());
      expect(v.outcome).toBe(Outcome.Fail);
      expect(v.failedCheck).toBe("replay");
    });
    it("passes a Router Episode (ADR 0004): the rebuild includes the Policy's chat_template_kwargs", async () => {
      const ep = honestEpisode(undefined, ROUTER_POLICY);
      expect((ep.log.decisions[0]!.request as { chat_template_kwargs?: unknown }).chat_template_kwargs).toEqual({ enable_thinking: false });
      expect((await verifyEpisode(deps(), ep)).outcome).toBe(Outcome.Pass);
    });

    it("fails a Router Decision whose request dropped or changed chat_template_kwargs", async () => {
      const dropped = honestEpisode(undefined, ROUTER_POLICY);
      delete (dropped.log.decisions[1]!.request as { chat_template_kwargs?: unknown }).chat_template_kwargs;
      expect((await verifyEpisode(deps(), dropped)).failedCheck).toBe("decisions");

      const thinking = honestEpisode(undefined, ROUTER_POLICY);
      (thinking.log.decisions[0]!.request as { chat_template_kwargs?: unknown }).chat_template_kwargs = { enable_thinking: true };
      expect((await verifyEpisode(deps(), thinking)).failedCheck).toBe("decisions");
    });

    it("fails a Decision answered by a provider other than the one the Policy commits to", async () => {
      const ep = honestEpisode();
      ep.log.decisions[1]!.providerAddress = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
      expect((await verifyEpisode(deps(), ep)).failedCheck).toBe("decisions");
    });
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

describe("Worker documents that are not valid content (issue #47: a Fail, never a missing Verdict)", () => {
  const LOG_NOT_JSON = "episode log is not valid JSON";
  const LOG_BAD_FORMAT = "episode log does not match the Episode Log format";
  const POLICY_NOT_JSON = "policy is not valid JSON";
  const POLICY_BAD_FORMAT = "policy does not match the Policy format";

  /** The same Episode with a Worker document swapped for downloaded content the Worker committed to. */
  const withLog = (log: unknown, decisionCount = 0): EpisodeInput => ({ ...honestEpisode(), log: log as EpisodeInput["log"], decisionCount });
  const withPolicy = (policy: unknown): EpisodeInput => {
    const ep = honestEpisode();
    // The Bid commits to exactly these bytes, so only the format check can catch them.
    const committed = policy instanceof NotJson ? ep.bid.policyHash : policyHash(policy as Policy);
    return { ...ep, bid: { ...ep.bid, policyHash: committed }, policy: policy as EpisodeInput["policy"] };
  };

  it("fails an Episode Log whose bytes are not JSON at the header check, with the reason in the evidence", async () => {
    const v = await verifyEpisode(deps(), withLog(new NotJson(), 3));
    expect(v).toMatchObject({ outcome: Outcome.Fail, failedCheck: "header", reason: LOG_NOT_JSON, pathCost: 0, collisions: 0 });
    const mismatch = honestEpisode();
    mismatch.decisionCount = 7;
    expect(v.evidenceHash).not.toBe((await verifyEpisode(deps(), mismatch)).evidenceHash);
  });

  it.each([
    ["null", null],
    ["a string", "hello"],
    ["an array", []],
    ["an empty header", { header: {}, decisions: [] }],
    ["a header with non-string fields", { header: { missionId: 1, worker: 2, policyRoot: 3, seedCommitment: 4 }, decisions: [] }],
    ["decisions that are not a list", { header: honestEpisode().log.header, decisions: "none" }],
  ])("fails an Episode Log that is JSON in the wrong shape (%s)", async (_name, log) => {
    const v = await verifyEpisode(deps(), withLog(log));
    expect(v).toMatchObject({ outcome: Outcome.Fail, failedCheck: "header", reason: LOG_BAD_FORMAT });
  });

  it("fails a Policy whose bytes are not JSON at the policy check", async () => {
    const v = await verifyEpisode(deps(), withPolicy(new NotJson()));
    expect(v).toMatchObject({ outcome: Outcome.Fail, failedCheck: "policy", reason: POLICY_NOT_JSON });
  });

  it.each([
    ["null", null],
    ["an empty object", {}],
    ["a numeric providerAddress", { ...POLICY, providerAddress: 42 }],
    ["no promptTemplate", { ...POLICY, promptTemplate: null }],
    ["a promptTemplate without placeholders", { ...POLICY, promptTemplate: "Reply FORWARD." }],
    ["a negative memoryWindow", { ...POLICY, memoryWindow: -1 }],
    ["requestOptions that override the model", { ...POLICY, requestOptions: { model: "other" } }],
  ])("fails a Policy that is JSON in the wrong shape, even when the Bid committed to it (%s)", async (_name, policy) => {
    const v = await verifyEpisode(deps(), withPolicy(policy));
    expect(v).toMatchObject({ outcome: Outcome.Fail, failedCheck: "policy", reason: POLICY_BAD_FORMAT });
  });

  it("keeps the spec order: an unsolvable Course is Invalid Course before the Policy is judged", async () => {
    const v = await verifyEpisode(deps(new FakeSim({ solvable: false })), withPolicy(new NotJson()));
    expect(v.outcome).toBe(Outcome.InvalidCourse);
  });

  it("gives every Verifier the same Outcome and evidence for the same bad content, so 2 matching Verdicts settle", async () => {
    for (const make of [() => withLog(new NotJson(), 3), () => withLog({ header: {}, decisions: [] }), () => withPolicy(new NotJson()), () => withPolicy({})]) {
      const verdicts = await Promise.all([1, 2, 3].map(() => verifyEpisode(deps(), make())));
      expect(new Set(verdicts.map((v) => `${v.outcome}:${v.evidenceHash}`)).size).toBe(1);
    }
    const reasons = await Promise.all([withLog(new NotJson(), 3), withLog(null), withPolicy(new NotJson()), withPolicy({})].map((ep) => verifyEpisode(deps(), ep)));
    expect(new Set(reasons.map((v) => v.evidenceHash)).size).toBe(4);
  });
});
