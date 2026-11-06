import { describe, expect, it } from "vitest";
import { EscrowContract, toEscrowMission, type RawMission } from "../src/shared/escrow";

const VERIFIERS = [
  "0x0000000000000000000000000000000000000001",
  "0x0000000000000000000000000000000000000002",
  "0x0000000000000000000000000000000000000003",
] as const;

const raw: RawMission = {
  worker: "0x0000000000000000000000000000000000000000",
  verifiers: VERIFIERS,
  courseSeed: `0x${"11".repeat(32)}`,
  maxBounty: 10_000_000n,
  difficultyClass: 2,
  riskWeightBps: 7500,
  maxSteps: 40,
  maxCollisions: 1,
  price: 0n,
  bidStake: 0n,
  awardedAt: 0n,
  stakedAt: 0n,
  deadlines: { biddingEndsAt: 1_060n, stakeWindow: 30, episodeWindow: 300, rescueAt: 4_600n },
  state: 1,
};

describe("toEscrowMission", () => {
  it("reads the Mission terms from the on-chain struct", () => {
    expect(toEscrowMission(raw).terms).toMatchObject({
      maxBounty: 10_000_000n, difficultyClass: "hard", riskWeightBps: 7500, courseSeed: `0x${"11".repeat(32)}`, maxSteps: 40, maxCollisions: 1,
    });
    expect(toEscrowMission(raw).terms.deadlines).toEqual({ biddingClosesAt: 1_060, stakeWindow: 30, episodeWindow: 300, rescueAt: 4_600 });
    expect(toEscrowMission({ ...raw, difficultyClass: 0 }).terms.difficultyClass).toBe("easy");
    expect(toEscrowMission({ ...raw, difficultyClass: 1 }).terms.difficultyClass).toBe("medium");
  });

  it("reads the 3 on-chain Verifiers", () => {
    expect(toEscrowMission(raw).verifiers).toEqual(VERIFIERS);
  });

  it("rejects a difficultyClass this adapter does not know", () => {
    expect(() => toEscrowMission({ ...raw, difficultyClass: 3 })).toThrow(/difficultyClass/);
  });
});

describe("EscrowContract.findMission", () => {
  const ESCROW = "0x00000000000000000000000000000000000000dd";
  const REQUESTER = "0x00000000000000000000000000000000000000aa";
  const commitment = (byte: string) => `0x${byte.repeat(32)}` as const;

  /** A fake chain: MissionCreated logs at given blocks, each Mission carrying a Course Seed. */
  function chain(latest: bigint, missions: { block: bigint; missionId: string; courseSeed: string }[]) {
    const scans: { fromBlock: unknown; toBlock: unknown }[] = [];
    const clients = {
      wallet: { account: { address: REQUESTER } },
      public: {
        getBlockNumber: async () => latest,
        getContractEvents: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
          scans.push({ fromBlock, toBlock });
          return missions.filter((m) => m.block >= fromBlock && m.block <= toBlock).map((m) => ({ args: { missionId: m.missionId } }));
        },
        readContract: async ({ args }: { args: [string] }) => ({
          ...raw,
          courseSeed: missions.find((m) => m.missionId === args[0])!.courseSeed,
        }),
      },
    } as never;
    return { clients, scans };
  }

  it("pages the log scan from the deployment block in bounded chunks", async () => {
    const { clients, scans } = chain(1_250n, []);
    const escrow = new EscrowContract(clients, ESCROW, { fromBlock: 1_000n, logChunk: 100n });

    expect(await escrow.findMission(commitment("99"))).toBeNull();
    expect(scans).toEqual([
      { fromBlock: 1_151n, toBlock: 1_250n },
      { fromBlock: 1_051n, toBlock: 1_150n },
      { fromBlock: 1_000n, toBlock: 1_050n },
    ]);
  });

  it("stops at the newest chunk holding the Mission", async () => {
    const { clients, scans } = chain(1_250n, [
      { block: 1_010n, missionId: commitment("01"), courseSeed: commitment("aa") },
      { block: 1_230n, missionId: commitment("02"), courseSeed: commitment("bb") },
    ]);
    const escrow = new EscrowContract(clients, ESCROW, { fromBlock: 1_000n, logChunk: 100n });

    expect(await escrow.findMission(commitment("BB"))).toBe(commitment("02"));
    expect(scans).toHaveLength(1);
    expect(await escrow.findMission(commitment("aa"))).toBe(commitment("01"));
  });

  it("scans nothing when the deployment block is past the chain head", async () => {
    const { clients, scans } = chain(900n, []);
    expect(await new EscrowContract(clients, ESCROW, { fromBlock: 1_000n }).findMission(commitment("99"))).toBeNull();
    expect(scans).toEqual([]);
  });
});

describe("EscrowContract.assetBalance", () => {
  it("reads the account's balance of the escrow's settlement token", async () => {
    const calls: { address: string; functionName: string; args?: unknown[] }[] = [];
    const clients = {
      public: {
        readContract: async (call: { address: string; functionName: string; args?: unknown[] }) => {
          calls.push(call);
          return call.functionName === "asset" ? "0x0000000000000000000000000000000000068cda" : 1_250_000n;
        },
      },
    } as never;
    const escrow = new EscrowContract(clients, "0x00000000000000000000000000000000000000dd", { fromBlock: 0n });

    expect(await escrow.assetBalance("0x00000000000000000000000000000000000000aa")).toBe(1_250_000n);
    expect(calls.at(-1)).toMatchObject({
      address: "0x0000000000000000000000000000000000068cda",
      functionName: "balanceOf",
      args: ["0x00000000000000000000000000000000000000aa"],
    });
  });
});

describe("EscrowContract settlement asset", () => {
  it("does not cache a failed lookup", async () => {
    const reads = [Promise.reject(new Error("rpc blip")), Promise.resolve("0x00000000000000000000000000000000000000cc")];
    const clients = { public: { readContract: () => reads.shift() } } as never;
    const escrow = new EscrowContract(clients, "0x00000000000000000000000000000000000000dd", { fromBlock: 0n });
    const lookup = () => (escrow as unknown as { settlementAsset(): Promise<string> }).settlementAsset();

    await expect(lookup()).rejects.toThrow("rpc blip");
    expect(await lookup()).toBe("0x00000000000000000000000000000000000000cc");
  });
});
