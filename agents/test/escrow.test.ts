import { describe, expect, it } from "vitest";
import { toEscrowMission, type RawMission } from "../src/shared/escrow";

const raw: RawMission = {
  worker: "0x0000000000000000000000000000000000000000",
  seedCommitment: `0x${"11".repeat(32)}`,
  maxBounty: 10_000_000n,
  difficultyClass: 2,
  riskWeightBps: 7500,
  price: 0n,
  bidStake: 0n,
  awardedAt: 0n,
  stakedAt: 0n,
  deadlines: { biddingEndsAt: 1_060n, stakeWindow: 30, seedReleaseWindow: 30, episodeWindow: 300, rescueAt: 4_600n },
  state: 1,
};

describe("toEscrowMission", () => {
  it("reads the Mission terms from the on-chain struct", () => {
    expect(toEscrowMission(raw).terms).toMatchObject({ maxBounty: 10_000_000n, difficultyClass: "hard", riskWeightBps: 7500 });
    expect(toEscrowMission({ ...raw, difficultyClass: 0 }).terms.difficultyClass).toBe("easy");
    expect(toEscrowMission({ ...raw, difficultyClass: 1 }).terms.difficultyClass).toBe("medium");
  });

  it("rejects a difficultyClass this adapter does not know", () => {
    expect(() => toEscrowMission({ ...raw, difficultyClass: 3 })).toThrow(/difficultyClass/);
  });
});
