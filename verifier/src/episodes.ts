import type { EpisodeLog, Policy } from "@dewo/agents/formats";
import type { Hex } from "viem";
import { PendingError, StorageUnavailableError } from "./errors.js";
import {
  NotUploaded, type BoardPort, type EpisodeRegistryPort, type EpisodeSource, type EscrowPort, type Fetched, type LoadedEpisode,
  type SeedPort, type StoragePort, type UploadRecordPort,
} from "./ports.js";

export interface EpisodeSourceDeps {
  board: BoardPort; chain: EscrowPort; seeds: SeedPort; registry: EpisodeRegistryPort; storage: StoragePort; uploads: UploadRecordPort;
}

/** Slack before the stake for clock skew between Hedera consensus time and Galileo block time. */
export const UPLOAD_CLOCK_SKEW = 300;

/**
 * The document under `root`. When 0G Storage cannot serve it, the Flow contract decides whose fault that is: a root with no
 * submission between the Worker's stake and its Episode Submission was never uploaded (NotUploaded, a Fail); a submitted one is
 * infrastructure, so the StorageUnavailableError stands (no Verdict). A Flow lookup that fails also leaves it as infrastructure.
 */
async function fetchDocument(deps: EpisodeSourceDeps, root: Hex, window: { from: number; to: number }): Promise<unknown> {
  try {
    return await deps.storage.downloadJson(root);
  } catch (e) {
    if (!(e instanceof StorageUnavailableError)) throw e;
    const submitted = await deps.uploads.submittedBetween(root, window.from, window.to).catch(() => true);
    if (submitted) throw e;
    return new NotUploaded();
  }
}

/**
 * Gather everything a Verdict needs: the Mission terms, winner and stake time (Hedera), Seed Release time and revealed seed
 * (Arkiv), the Episode Submission (0G Chain) and the Episode Log + Policy it points to (0G Storage).
 * `episode` is left out until a submission and the revealed seed both exist.
 */
export function createEpisodeSource(deps: EpisodeSourceDeps): EpisodeSource {
  return {
    async load(missionId: Hex): Promise<LoadedEpisode> {
      const { mission, requester, award, biddingEndsAt } = await deps.chain.getMission(missionId);
      if (!award) throw new PendingError(`no award for mission ${missionId} yet`);
      if (award.stakedAt === null) throw new PendingError(`mission ${missionId}: winner has not staked yet`);

      const [seedReleasedAt, submission, reveal, bids] = await Promise.all([
        deps.seeds.seedReleasedAt(missionId, award.worker, requester),
        deps.registry.findSubmission(missionId, award.worker),
        deps.seeds.revealedSeed(missionId, requester),
        deps.board.listBids(missionId, biddingEndsAt),
      ]);
      const timeline = { stakedAt: award.stakedAt, seedReleasedAt, episodeSubmittedAt: submission?.timestamp };
      const bid = bids.find((b) => b.worker.toLowerCase() === award.worker.toLowerCase());
      if (!submission || !reveal || !bid) return { mission, worker: award.worker, timeline };

      // Content that is not JSON, not well formed or never uploaded is passed on for the checks to Fail; a 0G outage rejects (no Verdict).
      const window = { from: award.stakedAt - UPLOAD_CLOCK_SKEW, to: submission.timestamp };
      const [log, policy] = (await Promise.all([
        fetchDocument(deps, submission.episodeLogRoot, window),
        fetchDocument(deps, submission.policyRoot, window),
      ])) as [Fetched<EpisodeLog>, Fetched<Policy>];
      return {
        mission, worker: award.worker, timeline,
        episode: { bid, reveal, policy, log, episodeLogRoot: submission.episodeLogRoot, decisionCount: submission.decisionCount },
      };
    },
  };
}
