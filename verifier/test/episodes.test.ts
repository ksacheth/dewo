import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { createEpisodeSource } from "../src/episodes.js";
import type { BoardPort } from "../src/ports.js";
import { SEED, SALT, MISSION, WORKER, POLICY, honestEpisode } from "./fixtures/builders.js";
import { policyHash } from "../src/formats.js";

const LOG_ROOT = ("0x" + "33".repeat(32)) as Hex;
const POLICY_ROOT = ("0x" + "22".repeat(32)) as Hex;

function world(over: { submission?: null; seeds?: boolean; award?: null } = {}) {
  const ep = honestEpisode();
  const downloads: Hex[] = [];
  const board: BoardPort = {
    getMission: async () => ep.mission, listBids: async () => [{ worker: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", policyHash: "0x00" }, ep.bid],
    openBid: async () => 0n, listVerdicts: async () => [],
  };
  const source = createEpisodeSource({
    board,
    escrow: { getAward: async () => (over.award === null ? null : { worker: WORKER, stakedAt: 1_000 }) },
    seeds: {
      seedReleasedAt: async () => 1_010,
      revealedSeed: async () => (over.seeds === false ? null : { seed: SEED, salt: SALT }),
    },
    registry: { findSubmission: async () => (over.submission === null ? null : { episodeLogRoot: LOG_ROOT, policyRoot: POLICY_ROOT, decisionCount: 3, timestamp: 1_100 }) },
    storage: { downloadJson: async <T>(root: Hex) => { downloads.push(root); return (root === LOG_ROOT ? ep.log : POLICY) as T; } },
  });
  return { source, downloads, ep };
}

describe("createEpisodeSource", () => {
  it("assembles the Episode from the registry submission, 0G Storage documents and the winner's Bid", async () => {
    const { source, downloads, ep } = world();
    const loaded = await source.load(MISSION);
    expect(loaded.worker).toBe(WORKER);
    expect(loaded.timeline).toEqual({ stakedAt: 1_000, seedReleasedAt: 1_010, episodeSubmittedAt: 1_100 });
    expect(downloads.sort()).toEqual([POLICY_ROOT, LOG_ROOT].sort());
    expect(loaded.episode).toMatchObject({
      bid: { worker: WORKER, policyHash: policyHash(POLICY) }, reveal: { seed: SEED, salt: SALT },
      episodeLogRoot: LOG_ROOT, decisionCount: 3, policy: POLICY, log: ep.log,
    });
  });

  it("has no episode and no submission time when the Worker never submitted (No-show evidence)", async () => {
    const { source, downloads } = world({ submission: null });
    const loaded = await source.load(MISSION);
    expect(loaded.episode).toBeUndefined();
    expect(loaded.timeline.episodeSubmittedAt).toBeUndefined();
    expect(downloads).toEqual([]);
  });

  it("has no episode while the seed has not been revealed yet", async () => {
    expect((await world({ seeds: false }).source.load(MISSION)).episode).toBeUndefined();
  });

  it("rejects when the Mission has no Award yet", async () => {
    await expect(world({ award: null }).source.load(MISSION)).rejects.toThrow(/no award/i);
  });
});
