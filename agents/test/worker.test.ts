import { describe, expect, it } from "vitest";
import { policyHash, type EpisodeLog } from "../src/formats";
import { ME, RIVAL, policy, setup, terms } from "./fakes";

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
    w.post("m1", terms({ maxBounty: 1 }));
    await w.worker.tick();
    expect(w.records.get("m1")).toMatchObject({ stage: "SKIPPED", note: "PRICE_ABOVE_MAX_BOUNTY" });
    expect(w.board.bids).toHaveLength(0);
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
    w.escrow.grant("m1", { stake: 0.7 });
    await w.worker.tick();
    expect(w.escrow.stakes).toEqual([{ missionId: "m1", amount: 0.7 }]);
    expect(w.stage()).toBe("STAKED");
  });

  it("never stakes twice when the chain already shows the stake", async () => {
    const w = setup();
    w.post();
    w.records.put({ missionId: "m1", stage: "WON" });
    w.escrow.grant("m1");
    w.escrow.patch("m1", { stakedAt: w.clock.now() });
    await w.worker.tick();
    expect(w.escrow.stakes).toHaveLength(0);
    expect(w.stage()).toBe("STAKED");
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

  it("flies the Episode and submits the Episode Log and Policy", async () => {
    const w = await staked();
    w.release();
    await w.worker.tick();

    expect(w.stage()).toBe("SUBMITTED");
    const [submission] = w.registry.submissions;
    expect(submission).toMatchObject({ missionId: "m1", decisionCount: 3 });

    const log = JSON.parse(w.storage.files.get(submission!.episodeLogRoot)!) as EpisodeLog;
    expect(log.header).toMatchObject({ missionId: "m1", worker: ME, policyRoot: submission!.policyRoot });
    expect(log.decisions.map((d) => d.action)).toEqual(["FORWARD", "FORWARD", "FORWARD"]);
    expect(w.sim.sessions[0]?.closed).toBe(true);
  });

  it("is done once the escrow settles", async () => {
    const w = await staked();
    w.release();
    await w.worker.tick();
    w.escrow.patch("m1", { settled: true });
    await w.worker.tick();
    expect(w.stage()).toBe("DONE");
  });

  it("waits for the Seed Release, then gives up after its window", async () => {
    const w = await staked();
    await w.worker.tick();
    expect(w.stage()).toBe("STAKED");
    w.clock.t += 31;
    await w.worker.tick();
    expect(w.records.get("m1")).toMatchObject({ stage: "GAVE_UP", note: "no Seed Release" });
  });

  it("refuses a seed that does not match the Seed Commitment", async () => {
    const w = await staked();
    w.release("m1", `0x${"9".repeat(64)}`);
    await w.worker.tick();
    expect(w.stage()).toBe("GAVE_UP");
    expect(w.sim.sessions).toHaveLength(0);
  });

  it("submits an honest partial log when 0G becomes unreachable", async () => {
    const w = await staked({ answers: ["FORWARD"] });
    w.release();
    await w.worker.tick();
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
