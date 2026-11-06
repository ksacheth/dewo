import { describe, expect, it } from "vitest";
import { EscrowContract, toEscrowMission, type RawMission } from "../src/shared/escrow";

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

describe("EscrowContract settlement asset", () => {
  it("does not cache a failed lookup", async () => {
    const reads = [Promise.reject(new Error("rpc blip")), Promise.resolve("0x00000000000000000000000000000000000000cc")];
    const clients = { public: { readContract: () => reads.shift() } } as never;
    const escrow = new EscrowContract(clients, "0x00000000000000000000000000000000000000dd");
    const lookup = () => (escrow as unknown as { settlementAsset(): Promise<string> }).settlementAsset();

    await expect(lookup()).rejects.toThrow("rpc blip");
    expect(await lookup()).toBe("0x00000000000000000000000000000000000000cc");
  });
});
