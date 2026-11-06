import { Outcome } from "./sign.js";

export interface Timeline {
  stakedAt: number;
  /** Block timestamp of EpisodeSubmitted on 0G; the No-show evidence. */
  episodeSubmittedAt?: number;
  /** The Mission's on-chain window in seconds (`MissionEscrow.Deadlines`). The Episode Submission deadline is stakedAt + episodeWindow. */
  episodeWindow: number;
  now: number;
}

/**
 * Outcome decided by the deadline alone (No-show), or null when the Episode is still pending or was submitted on time and needs a
 * Replay. The Course Seed is public from createMission (ADR 0006), so the Episode window runs from the stake.
 */
export function classifyTimeline(t: Timeline): Outcome | null {
  const deadline = t.stakedAt + t.episodeWindow;
  if (t.episodeSubmittedAt === undefined) return t.now > deadline ? Outcome.NoShow : null;
  return t.episodeSubmittedAt > deadline ? Outcome.NoShow : null;
}
