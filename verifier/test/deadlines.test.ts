import { describe, expect, it } from "vitest";
import { classifyTimeline, type Timeline } from "../src/deadlines.js";
import { Outcome } from "../src/sign.js";

// Spec section 3 default: Episode Submission within 5 min of the stake (the Course Seed is public from createMission, ADR 0006).
const T = 1_000;
const at = (t: Omit<Timeline, "episodeWindow">, episodeWindow = 300) => classifyTimeline({ ...t, episodeWindow });

describe("classifyTimeline", () => {
  it("is pending while the Episode deadline has not passed", () => {
    expect(at({ stakedAt: T, now: T + 299 })).toBeNull();
    expect(at({ stakedAt: T, now: T + 300 })).toBeNull();
  });
  it("is No-show when no Episode Submission exists 5 min after the stake", () => {
    expect(at({ stakedAt: T, now: T + 301 })).toBe(Outcome.NoShow);
  });
  it("is No-show when the Episode Submission block timestamp is late", () => {
    expect(at({ stakedAt: T, episodeSubmittedAt: T + 301, now: T + 1000 })).toBe(Outcome.NoShow);
  });
  it("needs a Replay (null) when the Episode was submitted on time, however late it is asked", () => {
    expect(at({ stakedAt: T, episodeSubmittedAt: T + 300, now: T + 10_000 })).toBeNull();
  });

  describe("uses the Mission's on-chain episodeWindow, not the spec default", () => {
    it("accepts a submission inside a longer episodeWindow", () => {
      expect(at({ stakedAt: T, episodeSubmittedAt: T + 800, now: T + 2000 }, 900)).toBeNull();
    });
    it("is No-show after a shorter episodeWindow", () => {
      expect(at({ stakedAt: T, now: T + 121 }, 120)).toBe(Outcome.NoShow);
    });
  });
});
