import type { EpisodeLog, Policy } from "@dewo/agents/formats";
import type { Hex } from "viem";
import { PendingError, StorageUnavailableError } from "./errors.js";
import {
  NotUploaded, type BoardPort, type EpisodeRegistryPort, type EpisodeSource, type EscrowPort, type Fetched, type LoadedEpisode,
  type StoragePort, type UploadRecordPort,
} from "./ports.js";

export interface EpisodeSourceDeps {
  board: BoardPort; chain: EscrowPort; registry: EpisodeRegistryPort; storage: StoragePort; uploads: UploadRecordPort;
}

/** Slack before the stake for clock skew between Hedera consensus time and Galileo block time. */
export const UPLOAD_CLOCK_SKEW = 300;

/**
 * The Worker's two documents. Whether each was uploaded is decided from the chain alone: a root with no Flow submission between the
 * Worker's stake and its Episode Submission is NotUploaded (a Fail) without downloading it, so a Verifier whose download would have
 * worked and one whose download fails reach the same Verdict. A submitted root that 0G Storage cannot serve is infrastructure
 * (StorageUnavailableError, no Verdict), and so is a Flow lookup that fails.
 */
async function fetchDocuments(deps: EpisodeSourceDeps, roots: [Hex, Hex], window: { from: number; to: number }): Promise<unknown[]> {
  const submitted = await deps.uploads.submittedBetween(roots, window.from, window.to).catch((e: unknown) => {
    throw new StorageUnavailableError(`0G Flow lookup failed: ${e instanceof Error ? e.message : String(e)}`);
  });
  return Promise.all(roots.map((root, i) => (submitted[i] ? deps.storage.downloadJson(root) : new NotUploaded())));
}

/**
 * Gather everything a Verdict needs: the Mission terms (with the public Course Seed and limits), winner and stake time (Hedera),
 * the winning Bid (Arkiv), the Episode Submission (0G Chain) and the Episode Log + Policy it points to (0G Storage).
 * `episode` is left out until a submission exists.
 */
export function createEpisodeSource(deps: EpisodeSourceDeps): EpisodeSource {
  return {
    async load(missionId: Hex): Promise<LoadedEpisode> {
      const { mission, award, biddingEndsAt } = await deps.chain.getMission(missionId);
      if (!award) throw new PendingError(`no award for mission ${missionId} yet`);
      if (award.stakedAt === null) throw new PendingError(`mission ${missionId}: winner has not staked yet`);

      const [submission, bids] = await Promise.all([
        deps.registry.findSubmission(missionId, award.worker),
        deps.board.listBids(missionId, biddingEndsAt),
      ]);
      const timeline = { stakedAt: award.stakedAt, episodeSubmittedAt: submission?.timestamp };
      const bid = bids.find((b) => b.worker.toLowerCase() === award.worker.toLowerCase());
      if (!submission || !bid) return { mission, worker: award.worker, timeline };

      // Content that is not JSON, not well formed or never uploaded is passed on for the checks to Fail; a 0G outage rejects (no Verdict).
      const window = { from: award.stakedAt - UPLOAD_CLOCK_SKEW, to: submission.timestamp };
      const [log, policy] = (await fetchDocuments(deps, [submission.episodeLogRoot, submission.policyRoot], window)) as [
        Fetched<EpisodeLog>, Fetched<Policy>,
      ];
      return {
        mission, worker: award.worker, timeline,
        episode: { bid, policy, log, episodeLogRoot: submission.episodeLogRoot, decisionCount: submission.decisionCount },
      };
    },
  };
}
