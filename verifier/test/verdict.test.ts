import { describe, expect, it } from "vitest";
import { SimInputError } from "../src/adapters/sim-cli.js";
import { verifyEpisode, type EpisodeInput } from "../src/checks/index.js";
import { NotJson, NotUploaded } from "../src/ports.js";
import { Outcome } from "../src/sign.js";
import { FakeSim, SEED, honestEpisode, zeroG, frameHashFor, pngFor, POLICY, ROUTER_POLICY } from "./fixtures/builders.js";
import { MAX_STEPS, buildRequest, policyHash, type Policy } from "@dewo/agents/formats";

const deps = (sim = new FakeSim(), g = zeroG()) => ({ sim, zeroG: g });

describe("verifyEpisode", () => {
  it("passes an honest Episode that reaches the goal within the limits, on the Course of the on-chain Course Seed", async () => {
    const sim = new FakeSim();
    const v = await verifyEpisode(deps(sim), honestEpisode());
    expect(v.outcome).toBe(Outcome.Pass);
    expect(v.steps).toBe(3);
    expect(v.collisions).toBe(0);
    expect(sim.seeds).toEqual([SEED]);
  });

  it("parses answers with the task of the on-chain Course Seed: ASCEND counts on a drone Mission only", async () => {
    const drone = honestEpisode(["ASCEND", "FORWARD", "FORWARD", "FORWARD"]);
    drone.mission = { ...drone.mission, courseSeed: `0x64726f6e${"5e".repeat(28)}` };
    drone.log.header = { ...drone.log.header, courseSeed: drone.mission.courseSeed };
    expect((await verifyEpisode(deps(), drone)).outcome).toBe(Outcome.Pass);
    // The same log on a rover Mission: "I will go ASCEND." parses to STOP, not the logged ASCEND.
    const rover = honestEpisode(["ASCEND", "FORWARD", "FORWARD", "FORWARD"]);
    const v = await verifyEpisode(deps(), rover);
    expect(v.outcome).toBe(Outcome.Fail);
  });

  describe("Mission Limits (spec 4.6, ADR 0006)", () => {
    const turns = (n: number) => Array<"TURN_RIGHT">(n).fill("TURN_RIGHT");
    const limited = (actions: Parameters<typeof honestEpisode>[0], limits: { maxSteps?: number; maxCollisions?: number }) => {
      const ep = honestEpisode(actions);
      ep.mission = { ...ep.mission, ...limits };
      return ep;
    };

    it("passes a detour: there is no optimal-path test any more", async () => {
      const v = await verifyEpisode(deps(), honestEpisode(["FORWARD", ...turns(10), "FORWARD", "FORWARD"]));
      expect(v.outcome).toBe(Outcome.Pass);
      expect(v.steps).toBe(13);
    });

    it("does not count STOP towards steps", async () => {
      const v = await verifyEpisode(deps(), honestEpisode(["FORWARD", "FORWARD", "FORWARD", "STOP"]));
      expect(v.outcome).toBe(Outcome.Pass);
      expect(v.steps).toBe(3);
    });

    it("passes at exactly maxSteps Decisions and fails one above, before any Replay", async () => {
      const actions = ["FORWARD", ...turns(4), "FORWARD", "FORWARD"] as const; // 7 Decisions
      expect((await verifyEpisode(deps(), limited([...actions], { maxSteps: 7 }))).outcome).toBe(Outcome.Pass);
      const sim = new FakeSim();
      const over = await verifyEpisode(deps(sim), limited([...actions], { maxSteps: 6 }));
      expect(over).toMatchObject({ outcome: Outcome.Fail, failedCheck: "steps", steps: 0 });
      expect(sim.seeds).toEqual([]);
    });

    it("never replays more than the protocol's MAX_STEPS, whatever maxSteps the escrow holds", async () => {
      const sim = new FakeSim();
      const long = limited(["FORWARD", ...turns(MAX_STEPS), "FORWARD", "FORWARD"], { maxSteps: 4_000_000_000 });
      expect(await verifyEpisode(deps(sim), long)).toMatchObject({ outcome: Outcome.Fail, failedCheck: "steps" });
      expect(sim.seeds).toEqual([]);
    });

    it("judges collisions against maxCollisions: a collision blocks a move but the Episode can still pass", async () => {
      const bumped = ["FORWARD", "TURN_LEFT", "FORWARD", "FORWARD"] as const;
      const strict = await verifyEpisode(deps(), limited([...bumped], { maxCollisions: 0 }));
      expect(strict).toMatchObject({ outcome: Outcome.Fail, failedCheck: "replay", collisions: 1 });
      const lenient = await verifyEpisode(deps(), limited([...bumped], { maxCollisions: 1 }));
      expect(lenient).toMatchObject({ outcome: Outcome.Pass, collisions: 1 });
    });

    it("fails an Episode that never reaches the goal", async () => {
      const v = await verifyEpisode(deps(), honestEpisode(["FORWARD", "FORWARD", "STOP"]));
      expect(v).toMatchObject({ outcome: Outcome.Fail, failedCheck: "replay" });
    });

    it("binds the limits it judged against into the evidence, so Verifiers reading other terms cannot match", async () => {
      const a = await verifyEpisode(deps(), limited(["FORWARD", "FORWARD", "FORWARD"], { maxSteps: 60 }));
      const b = await verifyEpisode(deps(), limited(["FORWARD", "FORWARD", "FORWARD"], { maxSteps: 59 }));
      expect(a.outcome).toBe(b.outcome);
      expect(a.evidenceHash).not.toBe(b.evidenceHash);
    });
  });

  it("fails a log whose header names another Course Seed", async () => {
    const ep = honestEpisode();
    ep.log = { ...ep.log, header: { ...ep.log.header, courseSeed: ("0x" + "ff".repeat(32)) as `0x${string}` } };
    const v = await verifyEpisode(deps(), ep);
    expect(v).toMatchObject({ outcome: Outcome.Fail, failedCheck: "header" });
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
      [() => honestEpisode(["FORWARD", "TURN_LEFT", "FORWARD", "FORWARD"]), new FakeSim()],
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
    const committed = policy instanceof NotJson || policy instanceof NotUploaded ? ep.bid.policyHash : policyHash(policy as Policy);
    return { ...ep, bid: { ...ep.bid, policyHash: committed }, policy: policy as EpisodeInput["policy"] };
  };

  it("fails an Episode Log whose bytes are not JSON at the header check, with the reason in the evidence", async () => {
    const v = await verifyEpisode(deps(), withLog(new NotJson(), 3));
    expect(v).toMatchObject({ outcome: Outcome.Fail, failedCheck: "header", reason: LOG_NOT_JSON, steps: 0, collisions: 0 });
    const mismatch = honestEpisode();
    mismatch.decisionCount = 7;
    expect(v.evidenceHash).not.toBe((await verifyEpisode(deps(), mismatch)).evidenceHash);
  });

  it.each([
    ["null", null],
    ["a string", "hello"],
    ["an array", []],
    ["an empty header", { header: {}, decisions: [] }],
    ["a header with non-string fields", { header: { missionId: 1, worker: 2, policyRoot: 3, courseSeed: 4 }, decisions: [] }],
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

  it("fails a never-uploaded Episode Log at the header check and a never-uploaded Policy at the policy check (issue #64)", async () => {
    const log = await verifyEpisode(deps(), withLog(new NotUploaded(), 3));
    expect(log).toMatchObject({ outcome: Outcome.Fail, failedCheck: "header", reason: "episode log was never uploaded to 0G Storage", steps: 0 });
    const policy = await verifyEpisode(deps(), withPolicy(new NotUploaded()));
    expect(policy).toMatchObject({ outcome: Outcome.Fail, failedCheck: "policy", reason: "policy was never uploaded to 0G Storage" });
    // The reason is in the evidence: a missing upload never hashes like bytes that are not JSON.
    expect(log.evidenceHash).not.toBe((await verifyEpisode(deps(), withLog(new NotJson(), 3))).evidenceHash);
    expect(policy.evidenceHash).not.toBe((await verifyEpisode(deps(), withPolicy(new NotJson()))).evidenceHash);
  });

  it("keeps the spec order: a Policy that is not valid content fails before the sim runs", async () => {
    const sim = new FakeSim();
    const v = await verifyEpisode(deps(sim), withPolicy(new NotJson()));
    expect(v).toMatchObject({ outcome: Outcome.Fail, failedCheck: "policy" });
    expect(sim.seeds).toEqual([]);
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
