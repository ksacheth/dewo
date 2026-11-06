import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { hederaEscrow, type RawMission } from "../src/adapters/escrow-chain.js";
import { zeroGCompute } from "../src/adapters/zerog-compute.js";
import { zeroGRegistry, type RegistryEntry } from "../src/adapters/zerog-registry.js";
import { zeroGStorage } from "../src/adapters/zerog-storage.js";

const MISSION = ("0x" + "11".repeat(32)) as Hex;
const WORKER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const REQUESTER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;

describe("zeroGCompute", () => {
  const broker = (result: boolean | null | Error) => ({
    inference: { processResponse: async () => { if (result instanceof Error) throw result; return result; } },
  });
  it("is valid only when processResponse returns true", async () => {
    expect(await zeroGCompute(broker(true)).verifyResponse(WORKER, "chat-1")).toBe(true);
  });
  it("treats an invalid answer, a skipped verification (null) and an SDK error as not valid", async () => {
    expect(await zeroGCompute(broker(false)).verifyResponse(WORKER, "c")).toBe(false);
    expect(await zeroGCompute(broker(null)).verifyResponse(WORKER, "c")).toBe(false);
    expect(await zeroGCompute(broker(new Error("provider unreachable"))).verifyResponse(WORKER, "c")).toBe(false);
  });
});

describe("zeroGRegistry (EpisodeRegistry.submissions)", () => {
  const entry = (over: Partial<RegistryEntry> = {}): RegistryEntry =>
    ({ episodeLogRoot: "0xaa", policyRoot: "0xbb", decisionCount: 3n, submittedAt: 1_100n, exists: true, ...over });
  const reader = (e: RegistryEntry) => ({ submissions: async (missionId: Hex, worker: string) => { expect([missionId, worker]).toEqual([MISSION, WORKER]); return e; } });

  it("returns the Worker's submission, with the block time as the submission time", async () => {
    expect(await zeroGRegistry(reader(entry())).findSubmission(MISSION, WORKER)).toEqual({ episodeLogRoot: "0xaa", policyRoot: "0xbb", decisionCount: 3, timestamp: 1_100 });
  });
  it("returns null when the Worker has not submitted (the contract returns an empty slot)", async () => {
    expect(await zeroGRegistry(reader(entry({ exists: false, submittedAt: 0n }))).findSubmission(MISSION, WORKER)).toBeNull();
  });
});

describe("zeroGStorage", () => {
  it("downloads a root as JSON", async () => {
    const indexer = { downloadToBlob: async (root: string) => { expect(root).toBe("0xroot"); return [new Blob([JSON.stringify({ a: 1 })]), null] as [Blob, null]; } };
    expect(await zeroGStorage(indexer).downloadJson("0xroot")).toEqual({ a: 1 });
  });
  it("throws the indexer error instead of parsing an empty blob", async () => {
    const indexer = { downloadToBlob: async () => [new Blob([]), new Error("not found")] as [Blob, Error] };
    await expect(zeroGStorage(indexer).downloadJson("0xroot")).rejects.toThrow("not found");
  });
});

describe("hederaEscrow (MissionEscrow)", () => {
  const raw = (over: Partial<RawMission> = {}): RawMission => ({
    requester: REQUESTER, worker: ZERO, seedCommitment: ("0x" + "cc".repeat(32)) as Hex, maxBounty: 10_000_000n, difficultyClass: 1, riskWeightBps: 5_000,
    price: 0n, bidStake: 0n, awardedAt: 0n, stakedAt: 0n, deadlines: { stakeWindow: 30, seedReleaseWindow: 45, episodeWindow: 600 }, state: 1, ...over,
  });
  const chain = (m: RawMission, lapsed: string[] = []) => hederaEscrow({ getMission: async () => m, lapsedWorker: async (_id, w) => lapsed.includes(w) });

  it("reads the Mission terms the Requester fixed on-chain: bounty, difficulty, risk weight from basis points, seed commitment", async () => {
    const { mission, requester, award } = await chain(raw()).getMission(MISSION);
    expect(mission).toEqual({ missionId: MISSION, difficultyClass: "medium", maxBounty: 10_000_000n, riskWeight: 0.5, seedCommitment: "0x" + "cc".repeat(32), deadlines: { seedReleaseWindow: 45, episodeWindow: 600 } });
    expect(requester).toBe(REQUESTER);
    expect(award).toBeNull();
  });
  it("reports the current Award and its stake window; stakedAt is null until the Worker stakes", async () => {
    const awarded = await chain(raw({ worker: WORKER, price: 4_000_000n, bidStake: 1_500_000n, awardedAt: 990n, state: 2 })).getMission(MISSION);
    expect(awarded.award).toEqual({ worker: WORKER, price: 4_000_000n, stake: 1_500_000n, awardedAt: 990, stakeWindow: 30, stakedAt: null });
    const staked = await chain(raw({ worker: WORKER, awardedAt: 990n, stakedAt: 1_000n, state: 3 })).getMission(MISSION);
    expect(staked.award?.stakedAt).toBe(1_000);
  });
  it("rejects a Mission the escrow does not know", async () => {
    await expect(chain(raw({ state: 0 })).getMission(MISSION)).rejects.toThrow(/no Mission/);
  });
  it("answers isLapsed from the lapsedWorker mapping", async () => {
    expect(await chain(raw(), [WORKER]).isLapsed(MISSION, WORKER)).toBe(true);
    expect(await chain(raw()).isLapsed(MISSION, WORKER)).toBe(false);
  });
});
