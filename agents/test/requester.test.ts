import { describe, expect, it, vi } from "vitest";
import { seedCommitment, toBaseUnits, type Hex } from "../src/formats";
import type { AuditPort, PaymentRecord } from "../src/requester/audit";
import { CREATE_RETRY_SECONDS } from "../src/requester/requester";
import { BIDDING_CLOSES_AFTER, REPLAY_PRICE, REQUESTER_ADDRESS, RIVAL, ME, SALT, SEED, VERIFIER_ADDRESSES, VERIFIER_URLS, requesterIn, world } from "./fakes";

const randoms = (): (() => Hex) => {
  const values: Hex[] = [SEED, SALT];
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
  it("fixes the terms on-chain and lists only the Seed Commitment", async () => {
    const s = setupRequester();
    const missionId = await s.post();

    const { terms } = await s.escrow.getMission(missionId);
    expect(terms).toMatchObject({ maxBounty: 10_000_000n, difficultyClass: "medium", riskWeightBps: 5000 });
    expect(terms.seedCommitment).toBe(seedCommitment(SEED, SALT));
    expect(terms.deadlines).toMatchObject({ biddingClosesAt: s.clock.t + 75, rescueAt: s.clock.t + 3600 });
    expect(JSON.stringify(s.board.listings, (_k, v) => (typeof v === "bigint" ? String(v) : v))).not.toContain(SEED.slice(2));
    expect(s.stage()).toBe("BIDDING");
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

describe("Requester: Seed Release and settlement", () => {
  it("releases the seed to the winner's key once it has staked", async () => {
    const s = await staked();
    expect(s.board.releases.get("m1")).toMatchObject({ seed: SEED, salt: SALT });
    expect(s.stage()).toBe("SEED_RELEASED");
  });

  it("reveals the seed, pays three Replays and settles a Pass", async () => {
    const s = await staked();
    await s.registry.submitEpisode("m1", "0x01", "0x02", 3);
    await s.requester.tick();

    expect(s.board.reveals.get("m1")).toEqual({ seed: SEED, salt: SALT });
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
    s.escrow.createMission = async (t) => {
      await create(t);
      throw new Error("crash");
    };
    await expect(s.post()).rejects.toThrow("crash");
    expect(s.records.all().map((r) => r.stage)).toEqual(["CREATING"]);

    s.escrow.createMission = create;
    await s.requester.tick();
    expect(s.escrow.missions.size).toBe(1);
    expect(s.stage()).toBe("BIDDING");
    expect(s.records.get("m1")).toMatchObject({ seed: SEED, salt: SALT });
    expect(s.board.listings).toHaveLength(1);

    s.bid(ME, 2);
    s.closeBidding();
    await s.requester.tick();
    await s.escrow.stake("m1", 500_000n);
    await s.requester.tick();
    expect(s.board.releases.get("m1")).toMatchObject({ seed: SEED, salt: SALT });
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
    expect([...s.escrow.missions.values()].map((m) => m.terms.seedCommitment)).toEqual([seedCommitment(SEED, SALT)]);
    expect(s.stage()).toBe("BIDDING");
  });

  it("does not retry while createMission is still in flight", async () => {
    const s = setupRequester();
    let release = () => {};
    const create = s.escrow.createMission.bind(s.escrow);
    s.escrow.createMission = (t) => new Promise((resolve) => (release = () => resolve(create(t))));
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

  it("does not release the seed twice when a crash lost the record write", async () => {
    const s = await staked();
    expect(s.board.releases.size).toBe(1);
    s.records.put({ ...s.records.get("m1")!, stage: "AWARDED" });
    const release = vi.spyOn(s.board, "releaseSeed");
    await s.requester.tick();
    expect(release).not.toHaveBeenCalled();
    expect(s.stage()).toBe("SEED_RELEASED");
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
