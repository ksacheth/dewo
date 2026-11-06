import { describe, expect, it, vi } from "vitest";
import { keccak256 } from "viem";
import { canonicalJson, policyHash, type EpisodeLog } from "../src/formats";
import { SUBMIT_TX_SECONDS } from "../src/worker/worker";
import { ME, RIVAL, SEED, VERIFIER_ADDRESSES, policy, setup, terms, workerIn, world } from "./fakes";

describe("Worker: bidding", () => {
  it("seals its own price and commits to its Policy", async () => {
    const w = setup();
    w.post();
    await w.worker.tick();

    expect(w.stage()).toBe("BID_PLACED");
    expect(w.records.get("m1")?.price).toBeCloseTo(1.36, 10);
    expect(w.board.bids).toHaveLength(1);
    expect(w.board.bids[0]).toMatchObject({ missionId: "m1", worker: ME, policyHash: policyHash(policy) });
    expect(w.board.bids[0]?.sealedPrice).toHaveLength(3);
  });

  it("bids once per Mission, not every poll", async () => {
    const w = setup();
    w.post();
    await w.worker.tick();
    await w.worker.tick();
    expect(w.board.bids).toHaveLength(1);
  });

  it("skips using the on-chain max bounty", async () => {
    const w = setup();
    w.post("m1", terms({ maxBounty: 1_000_000n }));
    await w.worker.tick();
    expect(w.records.get("m1")).toMatchObject({ stage: "SKIPPED", note: "PRICE_ABOVE_MAX_BOUNTY" });
    expect(w.board.bids).toHaveLength(0);
  });

  it("skips a Mission whose on-chain Verifiers are not its trusted set (ADR 0005)", async () => {
    const w = setup();
    w.post("m1", terms(), [VERIFIER_ADDRESSES[0]!, VERIFIER_ADDRESSES[1]!, RIVAL]);
    await w.worker.tick();
    expect(w.records.get("m1")).toMatchObject({ stage: "SKIPPED", note: "UNTRUSTED_VERIFIERS" });
    expect(w.board.bids).toHaveLength(0);
  });

  it("bids when the on-chain Verifiers are its trusted set in another order and case", async () => {
    const w = setup();
    const [a, b, c] = VERIFIER_ADDRESSES as [`0x${string}`, `0x${string}`, `0x${string}`];
    w.post("m1", terms(), [c, a.toUpperCase().replace("0X", "0x") as `0x${string}`, b]);
    await w.worker.tick();
    expect(w.stage()).toBe("BID_PLACED");
  });

  it("does not stake a Bid re-adopted after a crash when the on-chain Verifiers are untrusted", async () => {
    const w = setup();
    w.post("m1", terms(), [VERIFIER_ADDRESSES[0]!, VERIFIER_ADDRESSES[1]!, RIVAL]);
    // A Bid on Arkiv with no local record: the process died between placeBid and the record write.
    await w.board.placeBid({ missionId: "m1", worker: ME, policyHash: policyHash(policy), workerPubKey: "0x04ab", sealedPrice: ["a", "b", "c"] });
    w.escrow.grant("m1");
    await w.worker.tick();
    await w.worker.tick();
    expect(w.records.get("m1")).toMatchObject({ stage: "LOST", note: "UNTRUSTED_VERIFIERS" });
    expect(w.escrow.stakes).toHaveLength(0);
  });

  it("does not stake a persisted WON record when the on-chain Verifiers are untrusted", async () => {
    const w = setup();
    w.post("m1", terms(), [VERIFIER_ADDRESSES[0]!, RIVAL, RIVAL]);
    w.records.put({ missionId: "m1", stage: "WON", price: 1.36 });
    w.escrow.grant("m1");
    await w.worker.tick();
    expect(w.records.get("m1")).toMatchObject({ stage: "LOST", note: "UNTRUSTED_VERIFIERS" });
    expect(w.escrow.stakes).toHaveLength(0);
  });

  it("skips instead of bidding 0 when its strategy prices the Mission at zero", async () => {
    const w = world();
    const me = workerIn(w, { margin: 0 });
    w.escrow.open("m1");
    w.board.open.push("m1");
    await me.worker.tick();
    expect(me.records.get("m1")).toMatchObject({ stage: "SKIPPED", note: "PRICE_NOT_POSITIVE" });
    expect(w.board.bids).toHaveLength(0);
  });

  it("stakes one second before the stake window ends and gives up at the boundary (R4)", async () => {
    const early = setup();
    early.post();
    await early.worker.tick();
    early.escrow.grant("m1");
    early.clock.t += 29;
    await early.worker.tick();
    expect(early.escrow.stakes).toHaveLength(1);

    const late = setup();
    late.post();
    await late.worker.tick();
    late.escrow.grant("m1");
    late.clock.t += 30;
    await late.worker.tick();
    expect(late.escrow.stakes).toHaveLength(0);
    expect(late.records.get("m1")).toMatchObject({ stage: "LOST", note: "missed the stake window" });
  });

  it("does not bid while busy with a won Mission", async () => {
    const w = setup();
    w.records.put({ missionId: "old", stage: "STAKED" });
    w.escrow.open("old");
    w.post();
    await w.worker.tick();
    expect(w.records.get("m1")).toMatchObject({ stage: "SKIPPED", note: "BUSY_WITH_UNFINISHED_WIN" });
  });
});

describe("Worker: Award and stake", () => {
  it("keeps watching while a rival holds an unstaked Award", async () => {
    const w = setup();
    w.post();
    await w.worker.tick();
    w.escrow.grant("m1", { worker: RIVAL });
    await w.worker.tick();
    expect(w.stage()).toBe("BID_PLACED");
  });

  it("loses once a rival stakes", async () => {
    const w = setup();
    w.post();
    await w.worker.tick();
    w.escrow.grant("m1", { worker: RIVAL });
    w.escrow.patch("m1", { stakedAt: w.clock.now() });
    await w.worker.tick();
    expect(w.stage()).toBe("LOST");
  });

  it("stakes the amount in the Award when the Award moves to it", async () => {
    const w = setup();
    w.post();
    await w.worker.tick();
    w.escrow.grant("m1", { stake: 700_000n });
    await w.worker.tick();
    expect(w.escrow.stakes).toEqual([{ missionId: "m1", amount: 700_000n }]);
    expect(w.stage()).toBe("SUBMITTED"); // staked, then flew at once: the Course Seed is public (ADR 0006)
  });

  it("never stakes twice when the chain already shows the stake", async () => {
    const w = setup();
    w.post();
    w.records.put({ missionId: "m1", stage: "WON" });
    w.escrow.grant("m1");
    w.escrow.patch("m1", { stakedAt: w.clock.now() });
    await w.worker.tick();
    expect(w.escrow.stakes).toHaveLength(0);
    expect(w.stage()).toBe("SUBMITTED"); // staked, then flew at once: the Course Seed is public (ADR 0006)
  });

  it("gives up the Award after the stake window", async () => {
    const w = setup();
    w.post();
    w.records.put({ missionId: "m1", stage: "WON" });
    w.escrow.grant("m1");
    w.clock.t += 31;
    await w.worker.tick();
    expect(w.records.get("m1")).toMatchObject({ stage: "LOST", note: "missed the stake window" });
    expect(w.escrow.stakes).toHaveLength(0);
  });
});

describe("Worker: Episode and submission", () => {
  async function staked(options: Parameters<typeof setup>[0] = {}) {
    const w = setup(options);
    w.post();
    await w.worker.tick();
    w.escrow.grant("m1");
    await w.worker.tick();
    return w;
  }

  it("flies the Episode right after the stake, on the public Course Seed, and submits the Episode Log and Policy", async () => {
    const w = await staked();

    expect(w.stage()).toBe("SUBMITTED");
    expect(w.sim.seeds).toEqual([SEED]);
    const [submission] = w.registry.submissions;
    expect(submission).toMatchObject({ missionId: "m1", decisionCount: 3 });

    const log = JSON.parse(w.storage.files.get(submission!.episodeLogRoot)!) as EpisodeLog;
    expect(log.header).toEqual({ missionId: "m1", worker: ME, policyRoot: submission!.policyRoot, courseSeed: SEED });
    expect(log.decisions.map((d) => d.action)).toEqual(["FORWARD", "FORWARD", "FORWARD"]);
    expect(w.sim.sessions[0]?.closed).toBe(true);
  });

  it("is done once the escrow settles", async () => {
    const w = await staked();
    w.escrow.patch("m1", { settled: true });
    await w.worker.tick();
    expect(w.stage()).toBe("DONE");
  });

  it("does not fly once the Episode window (stakedAt + episodeWindow) is over", async () => {
    const w = setup();
    w.post();
    w.escrow.grant("m1");
    w.escrow.patch("m1", { stakedAt: w.clock.now() });
    w.records.put({ missionId: "m1", stage: "STAKED" });
    w.clock.t += 301;
    await w.worker.tick();
    expect(w.records.get("m1")).toMatchObject({ stage: "GAVE_UP", note: "Episode window already over" });
    expect(w.sim.sessions).toHaveLength(0);
  });

  it("stops at the Mission's maxSteps and submits what it flew", async () => {
    // The goal is reachable within 4 steps, but this Policy only turns: each turn bumps a wall, which 10 collisions allow.
    const w = setup({ goalAt: 3, answers: Array(10).fill("TURN_RIGHT") });
    w.post("m1", terms({ maxSteps: 4, maxCollisions: 10 }));
    await w.worker.tick();
    w.escrow.grant("m1");
    await w.worker.tick();
    expect(w.stage()).toBe("SUBMITTED");
    expect(w.registry.submissions[0]?.decisionCount).toBe(4);
  });

  it("stops flying at stakedAt + episodeWindow - the submit margin, then still submits on time", async () => {
    const w = setup({ goalAt: 10, answers: Array(10).fill("FORWARD") });
    w.post();
    await w.worker.tick();
    w.escrow.grant("m1");
    // Each 0G answer takes 50 s: the default window (300 s) less the 90 s margin leaves room for Decisions starting at 0..200 s.
    const answer = w.inference.complete.bind(w.inference);
    w.inference.complete = async (provider, request) => { w.clock.t += 50; return answer(provider, request); };
    await w.worker.tick();
    expect(w.stage()).toBe("SUBMITTED");
    expect(w.registry.submissions[0]?.decisionCount).toBe(5);
  });

  it("submits an honest partial log when 0G becomes unreachable", async () => {
    const w = await staked({ answers: ["FORWARD"] });
    expect(w.stage()).toBe("SUBMITTED");
    expect(w.registry.submissions[0]?.decisionCount).toBe(1);
  });

  it("does not retry an Episode cut short by a crash", async () => {
    const w = setup();
    w.post();
    w.records.put({ missionId: "m1", stage: "EPISODE_RUNNING" });
    await w.worker.reconcile();
    expect(w.stage()).toBe("GAVE_UP");
  });

  it("recovers a submission made just before a crash", async () => {
    const w = setup();
    w.post();
    w.records.put({ missionId: "m1", stage: "EPISODE_RUNNING" });
    await w.registry.submitEpisode("m1", "0x01", "0x02", 3);
    await w.worker.reconcile();
    expect(w.stage()).toBe("SUBMITTED");
  });
});

describe("Worker: one bad Mission does not stop the others", () => {
  it("stakes a won Mission even when another listing throws", async () => {
    const w = setup();
    w.post("m1");
    await w.worker.tick();
    w.escrow.grant("m1");
    w.board.open.unshift("bogus"); // listed on Arkiv, unknown to the escrow
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    await w.worker.tick();

    expect(w.stage("m1")).toBe("SUBMITTED"); // staked, then flew at once
    expect(w.escrow.stakes).toHaveLength(1);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("bogus"), expect.anything());
    errors.mockRestore();
  });

  it("keeps advancing the other tracked Missions when one record throws", async () => {
    const w = setup();
    w.records.put({ missionId: "ghost", stage: "BID_PLACED" }); // no such escrow Mission
    w.post("m1");
    w.records.put({ missionId: "m1", stage: "WON" });
    w.escrow.grant("m1");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    await w.worker.tick();

    expect(w.stage("m1")).toBe("SUBMITTED"); // staked, then flew at once
    errors.mockRestore();
  });
});

describe("Worker: restart after a crash while bidding", () => {
  it("does not bid twice when the Bid is on Arkiv but the record was never written", async () => {
    const w = setup();
    w.post();
    const crashing = vi.spyOn(w.records, "put").mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await w.worker.tick();
    crashing.mockRestore();
    errors.mockRestore();
    expect(w.board.bids).toHaveLength(1);
    expect(w.records.get("m1")).toBeUndefined();

    await w.worker.tick(); // restart: no record, but the Bid exists
    expect(w.board.bids).toHaveLength(1);
    expect(w.stage()).toBe("BID_PLACED");
  });
});

describe("Worker: retrying a flown Episode", () => {
  async function flown() {
    const w = setup();
    w.post();
    await w.worker.tick();
    w.escrow.grant("m1");
    return w;
  }

  it("withdraws a deferred payout once its Mission settles, retrying while delivery fails", async () => {
    const w = await flown();
    await w.worker.tick();
    expect(w.stage()).toBe("SUBMITTED");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    w.escrow.owedBy.set(ME, 7_700_000n);
    w.escrow.withdrawFails = true;
    w.escrow.patch("m1", { settled: true });

    await w.worker.tick();
    expect(w.stage()).toBe("DONE");
    expect(w.escrow.withdrawals).toHaveLength(0);

    w.escrow.withdrawFails = false;
    await w.worker.tick();
    expect(w.escrow.withdrawals).toEqual([{ account: ME, amount: 7_700_000n }]);
    errors.mockRestore();
  });

  it("does not withdraw before any Mission has settled", async () => {
    const w = await flown();
    await w.worker.tick();
    w.escrow.owedBy.set(ME, 1n);
    await w.worker.tick();
    // The startup check ran before the amount was parked; only a settled Mission makes it check again.
    expect(w.escrow.withdrawals).toHaveLength(0);
  });

  it("keeps the Episode when the upload fails and submits it on the next tick without re-flying", async () => {
    const w = await flown();
    vi.spyOn(w.storage, "upload").mockRejectedValueOnce(new Error("0G storage down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    await w.worker.tick();
    expect(w.stage()).toBe("EPISODE_DONE");
    expect(w.records.get("m1")?.episode?.decisions).toHaveLength(3);
    expect(w.registry.submissions).toHaveLength(0);

    await w.worker.tick();
    expect(w.stage()).toBe("SUBMITTED");
    expect(w.records.get("m1")?.episode).toBeUndefined();
    expect(w.registry.submissions).toHaveLength(1);
    expect(w.sim.sessions).toHaveLength(1);
    errors.mockRestore();
  });

  it("gives up only once the Episode Submission deadline has passed", async () => {
    const w = await flown();
    vi.spyOn(w.registry, "submitEpisode").mockRejectedValue(new Error("chain down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    await w.worker.tick();
    expect(w.stage()).toBe("EPISODE_DONE");
    w.clock.t += 301;
    await w.worker.tick();
    expect(w.records.get("m1")).toMatchObject({ stage: "GAVE_UP", note: "Episode Submission deadline passed" });
    errors.mockRestore();
  });

  it("recovers to SUBMITTED, without a second submit, when the chain already has the submission", async () => {
    const w = await flown();
    await w.worker.tick();
    const [only] = w.registry.submissions;
    w.records.put({ missionId: "m1", stage: "EPISODE_DONE", episode: { decisions: [], deadline: w.clock.now() + 100 } });
    await w.worker.tick();
    expect(w.stage()).toBe("SUBMITTED");
    expect(w.registry.submissions).toEqual([only]);
  });

  it("waits for a stalled 0G upload, then submits with the locally computed roots before the deadline (rescue, not a No-show)", async () => {
    const w = await flown();
    w.storage.hang = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});

    await w.worker.tick();
    expect(w.stage()).toBe("EPISODE_DONE");
    expect(w.registry.submissions).toHaveLength(0);

    const { deadline, decisions } = w.records.get("m1")!.episode!;
    w.clock.t = deadline - SUBMIT_TX_SECONDS;
    await w.worker.tick();
    expect(w.stage()).toBe("SUBMITTED");
    const policyRoot = keccak256(new TextEncoder().encode(canonicalJson(policy)));
    const log: EpisodeLog = { header: { missionId: "m1", worker: ME, policyRoot, courseSeed: SEED }, decisions };
    expect(w.registry.submissions).toEqual([
      { missionId: "m1", policyRoot, episodeLogRoot: keccak256(new TextEncoder().encode(JSON.stringify(log))), decisionCount: decisions.length },
    ]);
    errors.mockRestore();
    warnings.mockRestore();
  });

  it("rejoins an upload still in flight on the next tick instead of starting another", async () => {
    const w = await flown();
    w.storage.hang = true;
    const uploads = vi.spyOn(w.storage, "upload");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await w.worker.tick();
    await w.worker.tick();
    await w.worker.tick();
    expect(uploads).toHaveBeenCalledTimes(2); // the Policy and the Episode Log, once each
    errors.mockRestore();
  });

  it("stays busy while an Episode awaits submission", async () => {
    const w = await flown();
    vi.spyOn(w.storage, "upload").mockRejectedValue(new Error("down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await w.worker.tick();
    w.post("m2");
    await w.worker.tick();
    expect(w.records.get("m2")).toMatchObject({ stage: "SKIPPED", note: "BUSY_WITH_UNFINISHED_WIN" });
    errors.mockRestore();
  });
});

describe("Worker: feasibility of the public Course (ADR 0006)", () => {
  it("plans the escrow's Course Seed up to min(maxSteps, MAX_STEPS) and bids when a path fits", async () => {
    const w = setup({ goalAt: 3 });
    w.post("m1", terms({ maxSteps: 40 }));
    await w.worker.tick();
    expect(w.sim.plans).toEqual([{ seed: SEED, maxCost: 40 }]);
    expect(w.stage()).toBe("BID_PLACED");
  });

  it("skips with LIMITS_UNREACHABLE when no collision-free path fits maxSteps", async () => {
    const w = setup({ goalAt: 5 });
    w.post("m1", terms({ maxSteps: 4 }));
    await w.worker.tick();
    expect(w.records.get("m1")).toMatchObject({ stage: "SKIPPED", note: "LIMITS_UNREACHABLE" });
    expect(w.board.bids).toHaveLength(0);
  });

  it("skips with LIMITS_UNREACHABLE when the plan cannot run, rather than bid blind", async () => {
    const w = setup();
    w.sim.planFails = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    w.post();
    await w.worker.tick();
    errors.mockRestore();
    expect(w.records.get("m1")).toMatchObject({ stage: "SKIPPED", note: "LIMITS_UNREACHABLE" });
  });

  it("does not run the planner on a Mission with untrusted Verifiers", async () => {
    const w = setup();
    w.post("m1", terms(), ["0x00000000000000000000000000000000000000f1", ...VERIFIER_ADDRESSES.slice(1)]);
    await w.worker.tick();
    expect(w.sim.plans).toHaveLength(0);
    expect(w.records.get("m1")).toMatchObject({ stage: "SKIPPED", note: "UNTRUSTED_VERIFIERS" });
  });
});
