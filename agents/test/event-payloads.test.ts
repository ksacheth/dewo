// The I8 payloads M4 emits, checked field by field against M3's EventData shapes.
import { describe, expect, it } from "vitest";
import { policyHash } from "../src/formats";
import { payouts } from "../src/requester/payouts";
import { OUTCOMES } from "../src/requester/ports";
import type { EventType } from "../src/shared/events";
import { hederaTxUrl, zeroGTxUrl } from "../src/shared/tx-links";
import { BIDDING_CLOSES_AFTER, REPLAY_PRICE, RIVAL, VERIFIER_ADDRESSES, policy, requesterIn, workerIn, world } from "./fakes";

async function fullMission() {
  const w = world();
  const requester = requesterIn(w);
  const gambler = workerIn(w, { address: RIVAL, margin: 1.05 });
  const everyone = async () => {
    for (const agent of [requester.requester, gambler.worker]) await agent.tick();
  };
  const missionId = await requester.requester.post({ difficulty: "easy", maxBounty: 10, riskWeight: 0.5 });
  await everyone();
  w.clock.t += BIDDING_CLOSES_AFTER;
  for (let i = 0; i < 3; i++) await everyone();
  const of = (type: string) => w.events.filter((e) => e.type === type).map((e) => e.data);
  return { w, missionId, of };
}

describe("I8 payloads", () => {
  it("emits complete payloads for every event type", async () => {
    const { w, of } = await fullMission();
    const [award] = w.escrow.awards;
    const price = award!.award.price.toString();
    const stake = award!.award.stake.toString();

    expect(of("mission.posted")).toEqual([
      { difficultyClass: "easy", task: "rover", maxBounty: "10000000", riskWeight: 0.5, maxSteps: 60, maxCollisions: 0, biddingClosesAt: 1_075, arkivKey: "arkiv-mission-1" },
    ]);
    expect(of("bid.sealed")).toEqual([{ worker: RIVAL, workerName: "Careful", policyHash: policyHash(policy), arkivKey: "arkiv-bid-1" }]);
    expect(of("award.signed")).toEqual([
      { worker: RIVAL, price, stake, verifier: VERIFIER_ADDRESSES[0] },
      { worker: RIVAL, price, stake, verifier: VERIFIER_ADDRESSES[1] },
    ]);
    expect(of("stake.deposited")).toEqual([{ worker: RIVAL, stake }]);
    expect(of("decision.made")).toMatchObject([
      { step: 0, frame: "m1/frames/frame_0000.png", chatID: "chat-1", action: "FORWARD" },
      { step: 1, frame: "m1/frames/frame_0001.png", chatID: "chat-2", action: "FORWARD" },
      { step: 2, frame: "m1/frames/frame_0002.png", chatID: "chat-3", action: "FORWARD" },
    ]);
    const [episode] = w.registry.submissions;
    expect(of("episode.submitted")).toEqual([
      { episodeLogRoot: episode!.episodeLogRoot, policyRoot: episode!.policyRoot, decisionCount: 3 },
    ]);
    // D15: the Requester reports only the 402 challenge; each Verifier owns the "paid" event and its settlement link.
    expect(of("replay.paid")).toEqual(
      VERIFIER_ADDRESSES.map((verifier) => ({ verifier, status: 402, amount: REPLAY_PRICE.toString() })),
    );
    expect(of("settled")).toEqual([
      { outcome: "Pass", workerPayout: (BigInt(price) + BigInt(stake)).toString(), requesterPayout: (10_000_000n - BigInt(price)).toString() },
    ]);
  });

  it("links the transaction behind every on-chain event (Hedera on HashScan, 0G on Chainscan)", async () => {
    const { w } = await fullMission();
    const urlsOf = (type: string) => w.events.filter((e) => e.type === type).map((e) => e.txUrl);
    const hashscan = /^https:\/\/hashscan\.io\/testnet\/transaction\/0x[0-9a-f]{64}$/;
    const chainscan = /^https:\/\/chainscan-galileo\.0g\.ai\/tx\/0x[0-9a-f]{64}$/;

    for (const type of ["mission.posted", "award.signed", "stake.deposited", "settled"]) {
      const urls = urlsOf(type);
      expect(urls.length, type).toBeGreaterThan(0);
      for (const url of urls) expect(url, type).toMatch(hashscan);
    }
    expect(urlsOf("episode.submitted")).toEqual([expect.stringMatching(chainscan)]);
    // Both signatures of one Award ride in the same transaction.
    expect(new Set(urlsOf("award.signed")).size).toBe(1);
    // Off-chain events carry no link.
    for (const type of ["bid.sealed", "decision.made", "replay.paid"]) {
      for (const url of urlsOf(type)) expect(url, type).toBeUndefined();
    }
  });

  it("builds the explorer links from a transaction hash", () => {
    const hash = `0x${"ab".repeat(32)}` as const;
    expect(hederaTxUrl(hash)).toBe(`https://hashscan.io/testnet/transaction/${hash}`);
    expect(zeroGTxUrl(hash)).toBe(`https://chainscan-galileo.0g.ai/tx/${hash}`);
  });

  it("types every amount as a string of base units", async () => {
    const { w } = await fullMission();
    for (const { data } of w.events) {
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) expect(typeof value, key).not.toBe("bigint");
    }
  });
});

describe("I8 event types", () => {
  it("mirrors all 11 types of @dewo/board's EventData (a missing or extra key fails typecheck)", () => {
    const all: Record<EventType, true> = {
      "mission.posted": true,
      "bid.sealed": true,
      "bids.revealed": true,
      "award.signed": true,
      "stake.deposited": true,
      "decision.made": true,
      "rover.moved": true,
      "episode.submitted": true,
      "replay.paid": true,
      "verdict.signed": true,
      settled: true,
    };
    expect(Object.keys(all)).toHaveLength(11);
  });
});

describe("settlement payouts (spec Outcome table)", () => {
  const maxBounty = 10_000_000n;
  const price = 6_000_000n;
  const stake = 1_700_000n;

  it.each(["Pass"] as const)("%s pays the Worker price + stake and refunds the rest of the bounty", (outcome) => {
    expect(payouts(outcome, maxBounty, price, stake)).toEqual({ worker: 7_700_000n, requester: 4_000_000n });
  });

  it.each(["Fail", "NoShow"] as const)("%s pays the Worker nothing and the Requester bounty + stake", (outcome) => {
    expect(payouts(outcome, maxBounty, price, stake)).toEqual({ worker: 0n, requester: 11_700_000n });
  });

  it("covers every Outcome", () => {
    for (const outcome of OUTCOMES) expect(() => payouts(outcome, maxBounty, price, stake)).not.toThrow();
  });
});
