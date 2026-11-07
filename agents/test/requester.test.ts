import { describe, expect, it, vi } from "vitest";
import { taskOf, toBaseUnits, type Hex } from "../src/formats";
import type { AuditPort, PaymentRecord } from "../src/requester/audit";
import { CREATE_RETRY_SECONDS } from "../src/requester/requester";
import { BIDDING_CLOSES_AFTER, REPLAY_PRICE, REQUESTER_ADDRESS, RIVAL, ME, SEED, VERIFIER_ADDRESSES, VERIFIER_URLS, requesterIn, world } from "./fakes";

const randoms = (): (() => Hex) => {
  const values: Hex[] = [SEED];
  return () => values.shift()!;
};

function setupRequester() {
  const w = world();
  const r = requesterIn(w, { random: randoms() });
  const bid = (worker: Hex, price: number) =>
    w.board.bids.push({ missionId: "m1", worker, policyHash: "0x00", workerPubKey: `${worker}ff`, sealedPrice: [`enc(${toBaseUnits(price)})@k`] });
  const post = () => r.requester.post({ difficulty: "medium", maxBounty: 10, riskWeight: 0.5 });
  const closeBidding = () => (w.clock.t += BIDDING_CLOSES_AFTER);
  return { ...w, ...r, bid, post, closeBidding };
}

/** Posted, bid on by ME, awarded and staked. */
async function staked() {
  const s = setupRequester();
  await s.post();
  s.bid(ME, 2);
  s.closeBidding();
  await s.requester.tick();
  await s.escrow.stake("m1", 500_000n);
  await s.requester.tick();
  return s;
}

describe("Requester: posting", () => {
  it("fixes the terms on-chain, with the public Course Seed and the default limits, and lists them", async () => {
    const s = setupRequester();
    const missionId = await s.post();

    const { terms } = await s.escrow.getMission(missionId);
    expect(terms).toMatchObject({ maxBounty: 10_000_000n, difficultyClass: "medium", riskWeightBps: 5000, courseSeed: SEED, maxSteps: 60, maxCollisions: 0 });
    expect(terms.deadlines).toMatchObject({ biddingClosesAt: s.clock.t + 75, rescueAt: s.clock.t + 3600 });
    expect(s.board.listings[0]).toMatchObject({ courseSeed: SEED, maxSteps: 60, maxCollisions: 0 });
    expect(s.events.find((e) => e.type === "mission.posted")?.data).toMatchObject({ maxSteps: 60, maxCollisions: 0 });
    expect(s.stage()).toBe("BIDDING");
  });

  it("encodes a drone request in the Course Seed, so the task is fixed on-chain with it", async () => {
    const s = setupRequester();
    const missionId = await s.requester.post({ difficulty: "medium", maxBounty: 10, riskWeight: 0.5, task: "drone" });
    const { terms } = await s.escrow.getMission(missionId);
    expect(taskOf(terms.courseSeed)).toBe("drone");
    expect(terms.courseSeed.slice(10)).toBe(SEED.slice(10));
    expect(s.events.find((e) => e.type === "mission.posted")?.data).toMatchObject({ task: "drone" });
  });

  it("uses the limits the request names", async () => {
    const s = setupRequester();
    const missionId = await s.requester.post({ difficulty: "easy", maxBounty: 5, riskWeight: 0.2, maxSteps: 25, maxCollisions: 2 });
    expect((await s.escrow.getMission(missionId)).terms).toMatchObject({ maxSteps: 25, maxCollisions: 2 });
  });

  it("refuses limits createMission would reject", async () => {
    const s = setupRequester();
    await expect(s.requester.post({ difficulty: "easy", maxBounty: 5, riskWeight: 0.2, maxSteps: 0 })).rejects.toThrow(/maxSteps/);
    expect(s.escrow.missions.size).toBe(0);
  });
});

describe("Requester: Award", () => {
  it("waits for bidding to close", async () => {
    const s = setupRequester();
    await s.post();
    s.bid(ME, 2);
    await s.requester.tick();
    expect(s.escrow.awards).toHaveLength(0);
  });

  it("submits the Award two Verifiers agree on", async () => {
    const s = setupRequester();
    await s.post();
    s.bid(ME, 2);
    s.bid(RIVAL, 1.5);
    s.closeBidding();
    await s.requester.tick();

    expect(s.escrow.awards).toHaveLength(1);
    expect(s.escrow.awards[0]?.award).toMatchObject({ worker: RIVAL, price: 1_500_000n });
    expect(s.escrow.awards[0]?.signatures).toHaveLength(2);
    expect(s.stage()).toBe("AWARDED");
  });

  it("still reaches a Quorum with one Verifier down", async () => {
    const s = setupRequester();
    await s.post();
    s.bid(ME, 2);
    s.verifiers.broken.add(VERIFIER_URLS[0]!);
    s.closeBidding();
    await s.requester.tick();
    expect(s.stage()).toBe("AWARDED");
  });

  it("stops when there are no Bids", async () => {
    const s = setupRequester();
    await s.post();
    s.closeBidding();
    await s.requester.tick();
    expect(s.stage()).toBe("NO_BIDS");
  });

  it("re-awards to the next-best Bid when the winner misses the stake window", async () => {
    const s = setupRequester();
    await s.post();
    s.bid(ME, 2);
    s.bid(RIVAL, 1.5);
    s.closeBidding();
    await s.requester.tick();
    s.clock.t += 31;
    await s.requester.tick();

    expect(s.escrow.awards.map((a) => a.award.worker)).toEqual([RIVAL, ME]);
    expect(s.stage()).toBe("AWARDED");
  });
});

describe("Requester: Episode and settlement", () => {
  it("waits for the Episode once the winner has staked", async () => {
    const s = await staked();
    expect(s.stage()).toBe("STAKED");
  });

  it("pays three Replays and settles a Pass", async () => {
    const s = await staked();
    await s.registry.submitEpisode("m1", "0x01", "0x02", 3);
    await s.requester.tick();

    expect(s.verifiers.replays).toEqual(VERIFIER_URLS);
    expect(s.escrow.settlements[0]).toMatchObject({ missionId: "m1", outcome: "Pass" });
    expect(s.escrow.settlements[0]?.signatures).toHaveLength(2);
    expect(s.records.get("m1")).toMatchObject({ stage: "SETTLED", note: "Pass" });
  });

  it("settles a No-show once the Episode window passes with no submission", async () => {
    const s = await staked();
    await s.requester.tick();
    expect(s.escrow.settlements).toHaveLength(0);
    s.clock.t += 301;
    await s.requester.tick();
    expect(s.escrow.settlements[0]?.outcome).toBe("NoShow");
  });

  it("settles on the two agreeing Verdicts when one Verifier dissents", async () => {
    const s = await staked();
    s.verifiers.dissenting.add(VERIFIER_URLS[1]!);
    await s.registry.submitEpisode("m1", "0x01", "0x02", 3);
    await s.requester.tick();
    expect(s.escrow.settlements[0]?.outcome).toBe("Pass");
  });

  it("never pays for more Replays than its cap, even when Verifiers fail", async () => {
    const s = await staked();
    VERIFIER_URLS.slice(0, 2).forEach((url) => s.verifiers.broken.add(url));
    await s.registry.submitEpisode("m1", "0x01", "0x02", 3);
    await s.requester.tick();
    s.verifiers.broken.clear();
    await s.requester.tick();

    expect(s.records.get("m1")?.paidReplays).toBe(3);
    expect(s.escrow.settlements).toHaveLength(0);
    expect(s.records.get("m1")?.note).toContain("Replay budget");
  });
  it("asks again when a Verifier is not ready yet, without using up the Replay budget", async () => {
    const s = await staked();
    VERIFIER_URLS.forEach((url) => s.verifiers.notReady.add(url));
    await s.registry.submitEpisode("m1", "0x01", "0x02", 3);
    await s.requester.tick();
    await s.requester.tick();
    expect(s.records.get("m1")).toMatchObject({ stage: "VERIFYING", paidReplays: 0 });
    expect(s.records.get("m1")?.note).toContain("not ready yet");

    s.verifiers.notReady.clear();
    await s.requester.tick();
    expect(s.escrow.settlements[0]?.outcome).toBe("Pass");
    expect(s.records.get("m1")?.paidReplays).toBe(3);
  });

  it("emits replay.waiting once per change of reason or readyAt, not every tick", async () => {
    const s = await staked();
    VERIFIER_URLS.forEach((url) => s.verifiers.notReady.add(url));
    await s.registry.submitEpisode("m1", "0x01", "0x02", 3);
    const waiting = () => s.events.filter((e) => e.type === "replay.waiting");

    s.verifiers.notReadyAt = 1_220;
    await s.requester.tick();
    await s.requester.tick();
    expect(waiting()).toHaveLength(3);
    expect(waiting()[0]).toMatchObject({ missionId: "m1", data: { verifier: expect.stringMatching(/^0x/), reason: s.verifiers.notReadyReason, readyAt: 1_220 } });

    s.verifiers.notReadyAt = 1_300;
    await s.requester.tick();
    await s.requester.tick();
    expect(waiting()).toHaveLength(6);

    s.verifiers.notReadyReason = "mission m1: no Episode Submission yet";
    s.verifiers.notReadyAt = undefined;
    await s.requester.tick();
    await s.requester.tick();
    expect(waiting()).toHaveLength(9);
    expect(waiting().at(-1)?.data).toEqual({ verifier: expect.any(String), reason: "mission m1: no Episode Submission yet" });
  });
});

describe("Requester: HCS spending log", () => {
  async function settledWith(audit: AuditPort) {
    const w = world();
    const r = requesterIn(w, { audit });
    const missionId = await r.requester.post({ difficulty: "easy", maxBounty: 10, riskWeight: 0.5 });
    w.board.bids.push({ missionId, worker: ME, policyHash: "0x00", workerPubKey: "0x04", sealedPrice: ["enc(2000000)@k"] });
    w.clock.t += BIDDING_CLOSES_AFTER;
    await r.requester.tick();
    await w.escrow.stake(missionId, 500_000n);
    await r.requester.tick();
    await w.registry.submitEpisode(missionId, "0x01", "0x02", 3);
    await r.requester.tick();
    return { w, missionId };
  }

  it("records every paid Replay", async () => {
    const records: PaymentRecord[] = [];
    const { missionId } = await settledWith({ recordPayment: async (r) => void records.push(r) });
    expect(records.map((r) => r.verifierUrl)).toEqual(VERIFIER_URLS);
    expect(records.map((r) => r.verifier)).toEqual(VERIFIER_ADDRESSES);
    expect(records[0]).toEqual({
      missionId,
      verifier: VERIFIER_ADDRESSES[0],
      verifierUrl: VERIFIER_URLS[0],
      outcome: "Pass",
      amount: REPLAY_PRICE.toString(),
      payTo: "0.0.5005",
      network: "hedera:testnet",
      asset: "0.0.429274",
      paymentTx: `tx-${VERIFIER_URLS[0]}`,
      at: expect.any(String),
    });
  });

  it("still settles when the audit log is down", async () => {
    const { w } = await settledWith({ recordPayment: async () => Promise.reject(new Error("HCS down")) });
    expect(w.escrow.settlements).toHaveLength(1);
  });
});

describe("Requester: deferred payouts (R11)", () => {
  it("withdraws what the escrow parked for it after the Mission settles", async () => {
    const s = await staked();
    s.escrow.owedBy.set(REQUESTER_ADDRESS, 4_000_000n);
    await s.registry.submitEpisode("m1", "0x01", "0x02", 3);
    await s.requester.tick();

    expect(s.stage()).toBe("SETTLED");
    expect(s.escrow.withdrawals).toEqual([{ account: REQUESTER_ADDRESS, amount: 4_000_000n }]);
    expect(await s.escrow.owed(REQUESTER_ADDRESS)).toBe(0n);
  });

  it("does not block settling when withdraw fails, and retries on the next tick", async () => {
    const s = await staked();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    s.escrow.owedBy.set(REQUESTER_ADDRESS, 4_000_000n);
    s.escrow.withdrawFails = true;
    await s.registry.submitEpisode("m1", "0x01", "0x02", 3);
    await s.requester.tick();

    expect(s.stage()).toBe("SETTLED");
    expect(s.escrow.withdrawals).toHaveLength(0);
    expect(errors).toHaveBeenCalled();

    s.escrow.withdrawFails = false;
    await s.requester.tick();
    expect(s.escrow.withdrawals).toHaveLength(1);
    await s.requester.tick();
    expect(s.escrow.withdrawals).toHaveLength(1);
    errors.mockRestore();
  });

  it("claims after a rescue too", async () => {
    const s = setupRequester();
    await s.post();
    s.escrow.owedBy.set(REQUESTER_ADDRESS, 10_000_000n);
    s.clock.t += 3600;
    await s.requester.tick();

    expect(s.stage()).toBe("RESCUED");
    expect(s.escrow.withdrawals).toEqual([{ account: REQUESTER_ADDRESS, amount: 10_000_000n }]);
  });

  it("checks once at startup and then stays quiet while nothing is owed", async () => {
    const s = setupRequester();
    const owed = vi.spyOn(s.escrow, "owed");
    await s.requester.tick();
    await s.requester.tick();
    expect(owed).toHaveBeenCalledTimes(1);
  });
});

describe("Requester: crash safety", () => {
  it("saves the seed before createMission, so a crash after the lock still recovers it", async () => {
    const s = setupRequester();
    const create = s.escrow.createMission.bind(s.escrow);
    // The Mission is created on-chain, then the process dies before it learns the id.
    s.escrow.createMission = async (t, v) => {
      await create(t, v);
      throw new Error("crash");
    };
    await expect(s.post()).rejects.toThrow("crash");
    expect(s.records.all().map((r) => r.stage)).toEqual(["CREATING"]);

    s.escrow.createMission = create;
    await s.requester.tick();
    expect(s.escrow.missions.size).toBe(1);
    expect(s.stage()).toBe("BIDDING");
    expect(s.records.get("m1")).toMatchObject({ seed: SEED });
    expect(s.board.listings).toHaveLength(1);
    expect(s.escrow.missions.get("m1")?.terms.courseSeed).toBe(SEED);
  });

  it("retries createMission with the same seed once the failed attempt is stale", async () => {
    const s = setupRequester();
    const create = s.escrow.createMission.bind(s.escrow);
    s.escrow.createMission = async () => Promise.reject(new Error("rpc down"));
    await expect(s.post()).rejects.toThrow("rpc down");

    s.escrow.createMission = create;
    await s.requester.tick();
    expect(s.escrow.missions.size).toBe(0);
    s.clock.t += CREATE_RETRY_SECONDS + 1;
    await s.requester.tick();
    expect([...s.escrow.missions.values()].map((m) => m.terms.courseSeed)).toEqual([SEED]);
    expect(s.stage()).toBe("BIDDING");
  });

  it("does not retry while createMission is still in flight", async () => {
    const s = setupRequester();
    let release = () => {};
    const create = s.escrow.createMission.bind(s.escrow);
    s.escrow.createMission = (t, v) => new Promise((resolve) => (release = () => resolve(create(t, v))));
    const posting = s.post();
    s.clock.t += CREATE_RETRY_SECONDS + 1;
    await s.requester.tick();
    release();
    await posting;
    expect(s.escrow.missions.size).toBe(1);
  });

  it("keeps a funded Mission and lists it on a later tick when Arkiv fails", async () => {
    const s = setupRequester();
    const postMission = s.board.postMission.bind(s.board);
    s.board.postMission = async () => Promise.reject(new Error("arkiv down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await s.post();
    expect(s.stage()).toBe("CREATED");
    expect(s.board.listings).toHaveLength(0);

    s.board.postMission = postMission;
    await s.requester.tick();
    errors.mockRestore();
    expect(s.stage()).toBe("BIDDING");
    expect(s.board.listings).toHaveLength(1);
  });

  it("does not list twice when a crash lost the record write after postMission", async () => {
    const s = setupRequester();
    const postMission = s.board.postMission.bind(s.board);
    // The listing lands on Arkiv, then the process dies before the record moves on.
    s.board.postMission = async (listing) => {
      await postMission(listing);
      throw new Error("crash");
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await s.post();
    expect(s.stage()).toBe("CREATED");

    s.board.postMission = postMission;
    await s.requester.tick();
    errors.mockRestore();
    expect(s.board.listings).toHaveLength(1);
    expect(s.stage()).toBe("BIDDING");
    expect(s.events.filter((e) => e.type === "mission.posted")).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ arkivKey: "arkiv-mission-1" }) }),
    ]);
  });

  it("stops listing once bidding has closed and rescues it later", async () => {
    const s = setupRequester();
    s.board.postMission = async () => Promise.reject(new Error("arkiv down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await s.post();
    s.closeBidding();
    await s.requester.tick();
    expect(s.stage()).toBe("NO_BIDS");
    s.clock.t += 3600;
    await s.requester.tick();
    expect(s.stage()).toBe("RESCUED");
    vi.restoreAllMocks();
  });

  it("counts a Replay as spent before the payment goes out", async () => {
    const s = await staked();
    await s.registry.submitEpisode("m1", "0x01", "0x02", 3);
    const seen: number[] = [];
    const replay = s.verifiers.requestReplay.bind(s.verifiers);
    s.verifiers.requestReplay = async (url, id) => {
      seen.push(s.records.get("m1")!.paidReplays);
      return replay(url, id);
    };
    await s.requester.tick();
    expect(seen).toEqual([1, 2, 3]);
  });

  it("holds the Replay cap across a crash mid-payment", async () => {
    const s = await staked();
    await s.registry.submitEpisode("m1", "0x01", "0x02", 3);
    s.records.put({ ...s.records.get("m1")!, stage: "VERIFYING", paidReplays: 3 });
    await s.requester.tick();
    expect(s.verifiers.replays).toHaveLength(0);
    expect(s.records.get("m1")?.note).toContain("Replay budget");
  });
});

describe("Requester: rescue", () => {
  it("rescues a Mission with no Bids once rescueAt passes, not before", async () => {
    const s = setupRequester();
    await s.post();
    s.closeBidding();
    await s.requester.tick();
    expect(s.stage()).toBe("NO_BIDS");
    expect(s.escrow.rescues).toEqual([]);

    s.clock.t = 1_000 + 3600;
    await s.requester.tick();
    expect(s.escrow.rescues).toEqual(["m1"]);
    expect(s.stage()).toBe("RESCUED");
  });

  it("rescues a Mission stuck in VERIFYING", async () => {
    const s = await staked();
    VERIFIER_URLS.forEach((url) => s.verifiers.broken.add(url));
    s.clock.t += 301;
    await s.requester.tick();
    expect(s.stage()).toBe("VERIFYING");
    s.clock.t = 1_000 + 3600;
    await s.requester.tick();
    expect(s.stage()).toBe("RESCUED");
  });

  it("only records a Mission someone else rescued", async () => {
    const s = setupRequester();
    await s.post();
    s.clock.t = 1_000 + 3600;
    s.escrow.patch("m1", { settled: true });
    await s.requester.tick();
    expect(s.escrow.rescues).toEqual([]);
    expect(s.stage()).toBe("SETTLED");
  });
});

describe("Requester: isolation", () => {
  it("keeps going with the other Missions when one throws", async () => {
    const w = world();
    let n = 0;
    const { requester, records } = requesterIn(w, { random: () => `0x${(++n).toString(16).padStart(64, "0")}` });
    const request = { difficulty: "easy", maxBounty: 5, riskWeight: 0.5 } as const;
    await requester.post(request);
    await requester.post(request);
    w.board.bids.push({ missionId: "m2", worker: ME, policyHash: "0x00", workerPubKey: "0x04", sealedPrice: ["enc(2000000)@k"] });
    w.clock.t += BIDDING_CLOSES_AFTER;

    const real = w.escrow.getMission.bind(w.escrow);
    w.escrow.getMission = async (id) => (id === "m1" ? Promise.reject(new Error("rpc")) : real(id));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await requester.tick();
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("m1"), expect.anything());
    errors.mockRestore();

    expect(records.get("m1")?.stage).toBe("BIDDING");
    expect(records.get("m2")?.stage).toBe("AWARDED");
  });
});

describe("Requester: idempotent posting (#37)", () => {
  const request = { difficulty: "medium", maxBounty: 10, riskWeight: 0.5 } as const;

  it("returns the first Mission for a repeated key and never creates a second", async () => {
    const s = setupRequester();
    expect(await s.requester.postOnce(request, "k1")).toEqual({ missionId: "m1" });
    expect(await s.requester.postOnce(request, "k1")).toEqual({ missionId: "m1" });
    expect(s.escrow.missions.size).toBe(1);
    expect(s.records.get("m1")).toMatchObject({ idempotencyKey: "k1" });
  });

  it("answers pending while the first attempt is still in flight", async () => {
    const s = setupRequester();
    let release = () => {};
    const create = s.escrow.createMission.bind(s.escrow);
    s.escrow.createMission = (t, v) => new Promise((resolve) => (release = () => resolve(create(t, v))));
    const first = s.requester.postOnce(request, "k1");

    expect(await s.requester.postOnce(request, "k1")).toEqual({ pending: true, ref: SEED });
    release();
    expect(await first).toEqual({ missionId: "m1" });
    expect(s.escrow.missions.size).toBe(1);
  });

  it("does not lock a second bounty when createMission errors but still lands", async () => {
    const s = setupRequester();
    const create = s.escrow.createMission.bind(s.escrow);
    // An RPC timeout: the transaction lands, the caller only sees the error.
    s.escrow.createMission = async (t, v) => {
      await create(t, v);
      throw new Error("rpc timeout");
    };
    await expect(s.requester.postOnce(request, "k1")).rejects.toThrow("rpc timeout");
    s.escrow.createMission = create;

    expect(await s.requester.postOnce(request, "k1")).toEqual({ pending: true, ref: SEED });
    await s.requester.tick();
    expect(await s.requester.postOnce(request, "k1")).toEqual({ missionId: "m1" });
    expect(s.escrow.missions.size).toBe(1);
  });

  it("waits for the tick's retry after a failed attempt instead of starting another", async () => {
    const s = setupRequester();
    const create = s.escrow.createMission.bind(s.escrow);
    s.escrow.createMission = async () => Promise.reject(new Error("rpc down"));
    await expect(s.requester.postOnce(request, "k1")).rejects.toThrow("rpc down");
    s.escrow.createMission = create;

    expect(await s.requester.postOnce(request, "k1")).toMatchObject({ pending: true });
    expect(s.escrow.missions.size).toBe(0);
    s.clock.t += CREATE_RETRY_SECONDS + 1;
    await s.requester.tick();
    expect(await s.requester.postOnce(request, "k1")).toEqual({ missionId: "m1" });
    expect(s.escrow.missions.size).toBe(1);
  });

  it("creates a new Mission for each request without a key, or with another key", async () => {
    const w = world();
    let n = 0;
    const { requester } = requesterIn(w, { random: () => `0x${(++n).toString(16).padStart(64, "0")}` });
    expect(await requester.postOnce(request)).toEqual({ missionId: "m1" });
    expect(await requester.postOnce(request)).toEqual({ missionId: "m2" });
    expect(await requester.postOnce(request, "a")).toEqual({ missionId: "m3" });
    expect(await requester.postOnce(request, "b")).toEqual({ missionId: "m4" });
  });
});
