import type { EpisodeLog, Policy } from "@dewo/agents/formats";
import type { Hex } from "viem";
import { classifyTimeline } from "./deadlines.js";
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

/** The Mission with its winner and stake time; pending (the Award may still lapse) until there is an Award and it is staked. */
async function stakedMission(chain: EscrowPort, missionId: Hex) {
  const read = await chain.getMission(missionId);
  const { award } = read;
  if (!award) throw new PendingError(`no award for mission ${missionId} yet`);
  if (award.stakedAt === null) throw new PendingError(`mission ${missionId}: winner has not staked yet`);
  return { ...read, award, stakedAt: award.stakedAt };
}

const winningBid = <B extends { worker: string }>(bids: readonly B[], worker: string): B | undefined =>
  bids.find((b) => b.worker.toLowerCase() === worker.toLowerCase());

/**
 * Gather everything a Verdict needs: the Mission terms (with the public Course Seed and limits), winner and stake time (Hedera),
 * the winning Bid (Arkiv), the Episode Submission (0G Chain) and the Episode Log + Policy it points to (0G Storage).
 * `episode` is left out until a submission exists.
 */
export function createEpisodeSource(deps: EpisodeSourceDeps): EpisodeSource {
  return {
    async load(missionId: Hex): Promise<LoadedEpisode> {
      const { mission, award, stakedAt, biddingEndsAt } = await stakedMission(deps.chain, missionId);
      const [submission, bids] = await Promise.all([
        deps.registry.findSubmission(missionId, award.worker),
        deps.board.listBids(missionId, biddingEndsAt),
      ]);
      const timeline = { stakedAt, episodeSubmittedAt: submission?.timestamp };
      const bid = winningBid(bids, award.worker);
      if (!submission || !bid) return { mission, worker: award.worker, timeline };

      // Content that is not JSON, not well formed or never uploaded is passed on for the checks to Fail; a 0G outage rejects (no Verdict).
      const window = { from: stakedAt - UPLOAD_CLOCK_SKEW, to: submission.timestamp };
      const [log, policy] = (await fetchDocuments(deps, [submission.episodeLogRoot, submission.policyRoot], window)) as [
        Fetched<EpisodeLog>, Fetched<Policy>,
      ];
      return {
        mission, worker: award.worker, timeline,
        episode: { bid, policy, log, episodeLogRoot: submission.episodeLogRoot, decisionCount: submission.decisionCount },
      };
    },

    // The same pending cases as decideVerdict, in the same order, but with reads only: no download, no Replay.
    async ready(missionId: Hex, now: number): Promise<void> {
      const { mission, award, stakedAt, biddingEndsAt } = await stakedMission(deps.chain, missionId);
      const submission = await deps.registry.findSubmission(missionId, award.worker);
      if (classifyTimeline({ stakedAt, episodeSubmittedAt: submission?.timestamp, ...mission.deadlines, now }) !== null) return; // a No-show
      if (!submission) throw new PendingError(`mission ${missionId}: no Episode Submission yet`);
      if (!winningBid(await deps.board.listBids(missionId, biddingEndsAt), award.worker)) {
        throw new PendingError(`mission ${missionId}: the winning Bid is not on Arkiv`);
      }
      await deps.uploads.assertPast(submission.timestamp);
    },
  };
}
