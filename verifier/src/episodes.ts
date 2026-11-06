import type { Hex } from "viem";
import { PendingError } from "./errors.js";
import type { EpisodeLog, Policy } from "@dewo/agents/formats";
import type { BoardPort, EpisodeRegistryPort, EpisodeSource, EscrowPort, LoadedEpisode, SeedPort, StoragePort } from "./ports.js";

export interface EpisodeSourceDeps {
  board: BoardPort; escrow: EscrowPort; seeds: SeedPort; registry: EpisodeRegistryPort; storage: StoragePort;
}

/**
 * Gather everything a Verdict needs: the winner and stake time (Hedera), Seed Release time and revealed seed (Arkiv),
 * the Episode Submission (0G Chain) and the Episode Log + Policy it points to (0G Storage).
 * `episode` is left out until a submission and the revealed seed both exist.
 */
export function createEpisodeSource(deps: EpisodeSourceDeps): EpisodeSource {
  return {
    async load(missionId: Hex): Promise<LoadedEpisode> {
      const [mission, award] = await Promise.all([deps.board.getMission(missionId), deps.escrow.getAward(missionId)]);
      if (!award) throw new Error(`no award for mission ${missionId}`);
      if (award.stakedAt === null) throw new PendingError(`mission ${missionId}: winner has not staked yet`);

      const [seedReleasedAt, submission, reveal, bids] = await Promise.all([
        deps.seeds.seedReleasedAt(missionId, award.worker),
        deps.registry.findSubmission(missionId, award.worker),
        deps.seeds.revealedSeed(missionId),
        deps.board.listBids(missionId),
      ]);
      const timeline = { stakedAt: award.stakedAt, seedReleasedAt, episodeSubmittedAt: submission?.timestamp };
      const bid = bids.find((b) => b.worker.toLowerCase() === award.worker.toLowerCase());
      if (!submission || !reveal || !bid) return { mission, worker: award.worker, timeline };

      const [log, policy] = await Promise.all([
        deps.storage.downloadJson<EpisodeLog>(submission.episodeLogRoot),
        deps.storage.downloadJson<Policy>(submission.policyRoot),
      ]);
      return {
        mission, worker: award.worker, timeline,
        episode: { bid, reveal, policy, log, episodeLogRoot: submission.episodeLogRoot, decisionCount: submission.decisionCount },
      };
    },
  };
}
