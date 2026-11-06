import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { policyHash } from "@dewo/agents/formats";
import { createEpisodeSource, UPLOAD_CLOCK_SKEW } from "../src/episodes.js";
import { PendingError, StorageUnavailableError } from "../src/errors.js";
import { NotJson, NotUploaded } from "../src/ports.js";
import { DEADLINES, LIMITS, MISSION, OTHER_WORKER, POLICY, SEED, WORKER, fakeBoard, fakeChain, honestEpisode } from "./fixtures/builders.js";

const LOG_ROOT = ("0x" + "33".repeat(32)) as Hex;
const POLICY_ROOT = ("0x" + "22".repeat(32)) as Hex;

interface Over {
  submission?: null; award?: null; unstaked?: boolean;
  stored?: (root: Hex) => Promise<unknown>;
  /** The 0G Flow lookup: whether the root was submitted in the window (default: every root was). */
  submitted?: (root: Hex) => Promise<boolean>;
  /** Galileo is not yet far enough past the Episode Submission for the Flow lookup to answer. */
  flowNotPast?: boolean;
  /** The winning Bid is missing from Arkiv. */
  noBid?: boolean;
}

function world(over: Over = {}) {
  const ep = honestEpisode();
  const downloads: Hex[] = [];
  const lookups: { roots: readonly Hex[]; from: number; to: number }[] = [];
  const award = over.award === null ? undefined : () => ({ worker: WORKER, price: 5_000_000n, stake: 1n, awardedAt: 990, stakeWindow: 30, stakedAt: over.unstaked ? null : 1_000 });
  const source = createEpisodeSource({
    board: fakeBoard({ prices: over.noBid ? { [OTHER_WORKER]: 1n } : { [OTHER_WORKER]: 1n, [WORKER]: 5_000_000n } }),
    chain: fakeChain({ award }),
    registry: { findSubmission: async (_m: Hex, worker: string) => (over.submission === null || worker !== WORKER ? null : { episodeLogRoot: LOG_ROOT, policyRoot: POLICY_ROOT, decisionCount: 3, timestamp: 1_100 }) },
    storage: { downloadJson: async (root: Hex) => { downloads.push(root); return over.stored ? over.stored(root) : root === LOG_ROOT ? ep.log : POLICY; } },
    uploads: {
      submittedBetween: async (roots, from, to) => {
        lookups.push({ roots, from, to });
        return Promise.all(roots.map((root) => (over.submitted ? over.submitted(root) : true)));
      },
      assertPast: async (to) => {
        if (over.flowNotPast) throw new Error(`Galileo is not 120 s past ${to} yet`);
      },
    },
  });
  return { source, downloads, ep, lookups };
}

describe("EpisodeSource.ready: the same pending cases as a Replay, checked without downloading anything", () => {
  const EPISODE_DEADLINE = 1_000 + DEADLINES.episodeWindow;
  it("is ready once the Episode is submitted, its Bid is on Arkiv and Galileo is past the submission, and downloads nothing", async () => {
    const { source, downloads, lookups } = world();
    await expect(source.ready(MISSION, 2_000)).resolves.toBeUndefined();
    expect(downloads).toEqual([]);
    expect(lookups).toEqual([]);
  });

  it("is pending without an Award, a stake, a submission inside the window, or the winning Bid", async () => {
    await expect(world({ award: null }).source.ready(MISSION, 2_000)).rejects.toBeInstanceOf(PendingError);
    await expect(world({ unstaked: true }).source.ready(MISSION, 2_000)).rejects.toBeInstanceOf(PendingError);
    await expect(world({ submission: null }).source.ready(MISSION, EPISODE_DEADLINE)).rejects.toBeInstanceOf(PendingError);
    await expect(world({ noBid: true }).source.ready(MISSION, 2_000)).rejects.toBeInstanceOf(PendingError);
  });

  it("is ready for a No-show once the Episode window is over", async () => {
    await expect(world({ submission: null }).source.ready(MISSION, EPISODE_DEADLINE + 1)).resolves.toBeUndefined();
  });

  it("is not ready while Galileo is not yet far enough past the submission (not a PendingError: a source cannot answer yet)", async () => {
    const ready = world({ flowNotPast: true }).source.ready(MISSION, 2_000);
    await expect(ready).rejects.toThrow(/not 120 s past 1100/);
    await expect(ready).rejects.not.toBeInstanceOf(PendingError);
  });
});

describe("createEpisodeSource", () => {
  it("assembles the Episode from the on-chain Mission (Course Seed, limits), the registry submission, 0G Storage documents and the winner's Bid", async () => {
    const { source, downloads, ep } = world();
    const loaded = await source.load(MISSION);
    expect(loaded.worker).toBe(WORKER);
    expect(loaded.mission).toMatchObject({ difficultyClass: "medium", maxBounty: 10_000_000n, courseSeed: SEED, ...LIMITS });
    expect(loaded.timeline).toEqual({ stakedAt: 1_000, episodeSubmittedAt: 1_100 });
    expect(downloads.sort()).toEqual([POLICY_ROOT, LOG_ROOT].sort());
    expect(loaded.episode).toMatchObject({
      bid: { worker: WORKER },
      episodeLogRoot: LOG_ROOT, decisionCount: 3, policy: POLICY, log: ep.log,
    });
    expect(policyHash(POLICY)).toBe(ep.bid.policyHash);
  });

  it("has no episode and no submission time when the Worker never submitted (No-show evidence)", async () => {
    const { source, downloads } = world({ submission: null });
    const loaded = await source.load(MISSION);
    expect(loaded.episode).toBeUndefined();
    expect(loaded.timeline.episodeSubmittedAt).toBeUndefined();
    expect(downloads).toEqual([]);
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

  describe("proof of upload (issue #64): whether a root was uploaded is decided from the 0G Flow contract alone", () => {
    const unreachable = (roots: Hex[]) => async (root: Hex) => {
      if (roots.includes(root)) throw new StorageUnavailableError(`0G Storage download of ${root} failed: file not found`);
      return root === LOG_ROOT ? honestEpisode().log : POLICY;
    };

    it("looks up both roots in one Flow scan over the window from the stake (less clock skew) to the Episode Submission", async () => {
      const { source, lookups } = world();
      await source.load(MISSION);
      expect(lookups).toEqual([{ roots: [LOG_ROOT, POLICY_ROOT], from: 1_000 - UPLOAD_CLOCK_SKEW, to: 1_100 }]);
    });

    it("hands a never-submitted Episode Log to the checks as NotUploaded without downloading it, so it ends in a Fail", async () => {
      const { source, downloads } = world({ submitted: async (root) => root !== LOG_ROOT });
      const loaded = await source.load(MISSION);
      expect(loaded.episode?.log).toBeInstanceOf(NotUploaded);
      expect(loaded.episode?.policy).toEqual(POLICY);
      expect(downloads).toEqual([POLICY_ROOT]);
    });

    it("hands a never-submitted Policy to the checks as NotUploaded", async () => {
      const loaded = await world({ submitted: async (root) => root !== POLICY_ROOT }).source.load(MISSION);
      expect(loaded.episode?.policy).toBeInstanceOf(NotUploaded);
      expect(loaded.episode?.log).not.toBeInstanceOf(NotUploaded);
    });

    it("gives the same answer whether or not 0G Storage could serve the never-submitted root, so Verifiers cannot split", async () => {
      const served = await world({ submitted: async (root) => root !== POLICY_ROOT }).source.load(MISSION);
      const failed = await world({ submitted: async (root) => root !== POLICY_ROOT, stored: unreachable([POLICY_ROOT]) }).source.load(MISSION);
      expect(served.episode?.policy).toBeInstanceOf(NotUploaded);
      expect(failed.episode?.policy).toBeInstanceOf(NotUploaded);
    });

    it("keeps a submitted root that cannot be downloaded as infrastructure: StorageUnavailableError, no Verdict", async () => {
      const load = world({ stored: unreachable([LOG_ROOT]) }).source.load(MISSION);
      await expect(load).rejects.toBeInstanceOf(StorageUnavailableError);
    });

    it("keeps a failed Flow lookup as infrastructure, without downloading anything", async () => {
      const { source, downloads } = world({ submitted: async () => { throw new Error("Galileo RPC down"); } });
      await expect(source.load(MISSION)).rejects.toBeInstanceOf(StorageUnavailableError);
      expect(downloads).toEqual([]);
    });
  });
});
