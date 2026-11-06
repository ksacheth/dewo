import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { policyHash } from "@dewo/agents/formats";
import { createEpisodeSource } from "../src/episodes.js";
import { PendingError, StorageUnavailableError } from "../src/errors.js";
import { NotJson } from "../src/ports.js";
import { SEED, SALT, MISSION, OTHER_WORKER, POLICY, REQUESTER, WORKER, fakeBoard, fakeChain, honestEpisode } from "./fixtures/builders.js";

const LOG_ROOT = ("0x" + "33".repeat(32)) as Hex;
const POLICY_ROOT = ("0x" + "22".repeat(32)) as Hex;

function world(over: { submission?: null; seeds?: boolean; award?: null; unstaked?: boolean; stored?: (root: Hex) => Promise<unknown> } = {}) {
  const ep = honestEpisode();
  const downloads: Hex[] = [];
  const asked: { releaseFor?: string; revealFor?: string } = {};
  const award = over.award === null ? undefined : () => ({ worker: WORKER, price: 5_000_000n, stake: 1n, awardedAt: 990, stakeWindow: 30, stakedAt: over.unstaked ? null : 1_000 });
  const source = createEpisodeSource({
    board: fakeBoard({ prices: { [OTHER_WORKER]: 1n, [WORKER]: 5_000_000n } }),
    chain: fakeChain({ award }),
    seeds: {
      seedReleasedAt: async (_m, _worker, requester) => { asked.releaseFor = requester; return 1_010; },
      revealedSeed: async (_m, requester) => { asked.revealFor = requester; return over.seeds === false ? null : { seed: SEED, salt: SALT }; },
    },
    registry: { findSubmission: async (_m: Hex, worker: string) => (over.submission === null || worker !== WORKER ? null : { episodeLogRoot: LOG_ROOT, policyRoot: POLICY_ROOT, decisionCount: 3, timestamp: 1_100 }) },
    storage: { downloadJson: async (root: Hex) => { downloads.push(root); return over.stored ? over.stored(root) : root === LOG_ROOT ? ep.log : POLICY; } },
  });
  return { source, downloads, ep, asked };
}

describe("createEpisodeSource", () => {
  it("assembles the Episode from the on-chain Mission, the registry submission, 0G Storage documents and the winner's Bid", async () => {
    const { source, downloads, ep } = world();
    const loaded = await source.load(MISSION);
    expect(loaded.worker).toBe(WORKER);
    expect(loaded.mission).toMatchObject({ difficultyClass: "medium", maxBounty: 10_000_000n, seedCommitment: ep.mission.seedCommitment });
    expect(loaded.timeline).toEqual({ stakedAt: 1_000, seedReleasedAt: 1_010, episodeSubmittedAt: 1_100 });
    expect(downloads.sort()).toEqual([POLICY_ROOT, LOG_ROOT].sort());
    expect(loaded.episode).toMatchObject({
      bid: { worker: WORKER }, reveal: { seed: SEED, salt: SALT },
      episodeLogRoot: LOG_ROOT, decisionCount: 3, policy: POLICY, log: ep.log,
    });
    expect(policyHash(POLICY)).toBe(ep.bid.policyHash);
  });

  it("looks up the Seed Release and the revealed seed under the on-chain Requester, whose Mission entity may have expired", async () => {
    const { source, asked } = world();
    await source.load(MISSION);
    expect(asked).toEqual({ releaseFor: REQUESTER, revealFor: REQUESTER });
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

  it("is pending (not an error) while the winner has not staked: the Award may still lapse", async () => {
    await expect(world({ unstaked: true }).source.load(MISSION)).rejects.toBeInstanceOf(PendingError);
  });

  it("is pending when the Mission has no Award yet", async () => {
    const load = world({ award: null }).source.load(MISSION);
    await expect(load).rejects.toBeInstanceOf(PendingError);
    await expect(load).rejects.toThrow(/no award/i);
  });

  it("hands content that is not JSON to the checks instead of throwing, so it ends in a Fail Verdict (issue #47)", async () => {
    const notJson = new NotJson();
    const loaded = await world({ stored: async () => notJson }).source.load(MISSION);
    expect(loaded.episode).toMatchObject({ log: notJson, policy: notJson, episodeLogRoot: LOG_ROOT });
  });

  it("lets a 0G outage through as a retryable StorageUnavailableError: no Episode, so no Verdict", async () => {
    const down = world({ stored: async () => { throw new StorageUnavailableError("indexer unreachable"); } });
    await expect(down.source.load(MISSION)).rejects.toBeInstanceOf(StorageUnavailableError);
  });
});
