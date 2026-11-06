import type { EpisodeLog, Policy } from "@dewo/agents/formats";
import type { Hex } from "viem";
import { PendingError } from "./errors.js";
import type { BoardPort, EpisodeRegistryPort, EpisodeSource, EscrowPort, LoadedEpisode, NotJson, StoragePort } from "./ports.js";

export interface EpisodeSourceDeps {
  board: BoardPort; chain: EscrowPort; registry: EpisodeRegistryPort; storage: StoragePort;
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

      // Content that is not JSON or not well formed is passed on for the checks to Fail; a 0G outage rejects (no Verdict).
      const [log, policy] = (await Promise.all([
        deps.storage.downloadJson(submission.episodeLogRoot),
        deps.storage.downloadJson(submission.policyRoot),
      ])) as [EpisodeLog | NotJson, Policy | NotJson];
      return {
        mission, worker: award.worker, timeline,
        episode: { bid, policy, log, episodeLogRoot: submission.episodeLogRoot, decisionCount: submission.decisionCount },
      };
    },
  };
}
