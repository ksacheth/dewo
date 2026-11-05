import { Outcome } from "./sign.js";

/** Tunable deadlines in seconds (spec section 3). */
export const SEED_RELEASE_WINDOW = 30;
export const EPISODE_WINDOW = 300;

export interface Timeline {
  stakedAt: number;
  seedReleasedAt?: number;
  /** Block timestamp of EpisodeSubmitted on 0G; the No-show evidence. */
  episodeSubmittedAt?: number;
  now: number;
}

/**
 * Outcome decided by deadlines alone, or null when the Mission is still pending or the Episode
 * was submitted on time and needs a Replay.
 */
export function classifyTimeline(t: Timeline): Outcome | null {
  const seedDeadline = t.stakedAt + SEED_RELEASE_WINDOW;
  if (t.seedReleasedAt === undefined) {
    // The Seed Release entity expires shortly after the Episode deadline, so an Episode Submission proves the Worker had the seed.
    if (t.episodeSubmittedAt !== undefined) return null;
    return t.now > seedDeadline ? Outcome.NoSeedRelease : null;
  }
  if (t.seedReleasedAt > seedDeadline) return Outcome.NoSeedRelease;

  const episodeDeadline = t.seedReleasedAt + EPISODE_WINDOW;
  if (t.episodeSubmittedAt === undefined) return t.now > episodeDeadline ? Outcome.NoShow : null;
  return t.episodeSubmittedAt > episodeDeadline ? Outcome.NoShow : null;
}
