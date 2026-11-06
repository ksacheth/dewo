import { LIFETIME_MS } from "@dewo/board";
import { EvidenceExpiredError } from "./errors.js";
import { Outcome } from "./sign.js";

/**
 * How long a Seed Release stays readable on Arkiv after it is written, in seconds. It cannot be written before the stake, so
 * every Seed Release is still visible until at least `stakedAt + SEED_RELEASE_VISIBLE`. After that, "no Seed Release found"
 * no longer proves the Requester never sent one.
 */
export const SEED_RELEASE_VISIBLE = LIFETIME_MS.seedRelease / 1000;

export interface Timeline {
  stakedAt: number;
  seedReleasedAt?: number;
  /** Block timestamp of EpisodeSubmitted on 0G; the No-show evidence. */
  episodeSubmittedAt?: number;
  /** The Mission's on-chain windows in seconds (`MissionEscrow.Deadlines`). */
  seedReleaseWindow: number;
  episodeWindow: number;
  now: number;
}

/** No Seed Release is visible: it was never sent, or it was sent and has since expired. */
function classifyWithoutSeedRelease(t: Timeline, seedDeadline: number): Outcome | null {
  if (t.episodeSubmittedAt !== undefined) {
    // A submission proves the Worker had the seed, but it must still beat the latest Episode deadline an on-time release allows.
    return t.episodeSubmittedAt > seedDeadline + t.episodeWindow ? Outcome.NoShow : null;
  }
  if (t.now <= seedDeadline) return null;
  // Past this point an on-time Seed Release could have expired, so its absence could be the Worker's No-show just as well.
  if (t.now > t.stakedAt + SEED_RELEASE_VISIBLE) {
    throw new EvidenceExpiredError("the Seed Release evidence has expired on Arkiv: No Seed Release and No-show can no longer be told apart");
  }
  return Outcome.NoSeedRelease;
}

/**
 * Outcome decided by deadlines alone, or null when the Mission is still pending or the Episode
 * was submitted on time and needs a Replay. Throws EvidenceExpiredError when the deadline evidence is gone.
 */
export function classifyTimeline(t: Timeline): Outcome | null {
  const seedDeadline = t.stakedAt + t.seedReleaseWindow;
  if (t.seedReleasedAt === undefined) return classifyWithoutSeedRelease(t, seedDeadline);
  if (t.seedReleasedAt > seedDeadline) return Outcome.NoSeedRelease;

  const episodeDeadline = t.seedReleasedAt + t.episodeWindow;
  if (t.episodeSubmittedAt === undefined) return t.now > episodeDeadline ? Outcome.NoShow : null;
  return t.episodeSubmittedAt > episodeDeadline ? Outcome.NoShow : null;
}
