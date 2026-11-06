import { describe, expect, it, vi } from "vitest";
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
    w.post("m1", terms({ maxBounty: 1_000_000n }));
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
    w.escrow.grant("m1", { stake: 700_000n });
    await w.worker.tick();
    expect(w.escrow.stakes).toEqual([{ missionId: "m1", amount: 700_000n }]);
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

describe("Worker: one bad Mission does not stop the others", () => {
  it("stakes a won Mission even when another listing throws", async () => {
    const w = setup();
    w.post("m1");
    await w.worker.tick();
    w.escrow.grant("m1");
    w.board.open.unshift("bogus"); // listed on Arkiv, unknown to the escrow
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    await w.worker.tick();

    expect(w.stage("m1")).toBe("STAKED");
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

    expect(w.stage("m1")).toBe("STAKED");
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
    await w.worker.tick();
    w.release();
    return w;
  }

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
