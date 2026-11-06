import { describe, expect, it } from "vitest";
import { seedCommitment, type Hex } from "../src/formats";
import { RIVAL, ME, SALT, SEED, VERIFIER_URLS, requesterIn, world } from "./fakes";

const randoms = (): (() => Hex) => {
  const values: Hex[] = [SEED, SALT];
  return () => values.shift()!;
};

function setupRequester() {
  const w = world();
  const r = requesterIn(w, { random: randoms() });
  const bid = (worker: Hex, price: number) =>
    w.board.bids.push({ missionId: "m1", worker, policyHash: "0x00", workerPubKey: `${worker}ff`, sealedPrice: [`enc(${price})@k`] });
  const post = () => r.requester.post({ difficulty: "medium", maxBounty: 10, riskWeight: 0.5 });
  const closeBidding = () => (w.clock.t += 61);
  return { ...w, ...r, bid, post, closeBidding };
}

/** Posted, bid on by ME, awarded and staked. */
async function staked() {
  const s = setupRequester();
  await s.post();
  s.bid(ME, 2);
  s.closeBidding();
  await s.requester.tick();
  await s.escrow.stake("m1", 0.5);
  await s.requester.tick();
  return s;
}

describe("Requester: posting", () => {
  it("fixes the terms on-chain and lists only the Seed Commitment", async () => {
    const s = setupRequester();
    const missionId = await s.post();

    const { terms } = await s.escrow.getMission(missionId);
    expect(terms).toMatchObject({ maxBounty: 10, difficultyClass: "medium", riskWeightBps: 5000 });
    expect(terms.seedCommitment).toBe(seedCommitment(SEED, SALT));
    expect(terms.deadlines.biddingClosesAt).toBe(s.clock.t + 60);
    expect(JSON.stringify(s.board.listings)).not.toContain(SEED.slice(2));
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
    expect(s.escrow.awards[0]?.award).toMatchObject({ worker: RIVAL, price: 1.5 });
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
