import { describe, expect, it } from "vitest";
import { SEED_RELEASE_VISIBLE, classifyTimeline, type Timeline } from "../src/deadlines.js";
import { EvidenceExpiredError } from "../src/errors.js";
import { Outcome } from "../src/sign.js";

// Spec section 3 defaults: Seed Release within 30 s of stake; Episode Submission within 5 min of Seed Release.
const T = 1_000;
const at = (t: Omit<Timeline, "seedReleaseWindow" | "episodeWindow">, windows = { seedReleaseWindow: 30, episodeWindow: 300 }) =>
  classifyTimeline({ ...t, ...windows });

describe("classifyTimeline", () => {
  it("is pending while the Seed Release deadline has not passed", () => {
    expect(at({ stakedAt: T, now: T + 29 })).toBeNull();
  });
  it("is No Seed Release when no Seed Release exists 30 s after stake", () => {
    expect(at({ stakedAt: T, now: T + 31 })).toBe(Outcome.NoSeedRelease);
  });
  it("is No Seed Release when the Seed Release landed after the deadline", () => {
    expect(at({ stakedAt: T, seedReleasedAt: T + 45, now: T + 60 })).toBe(Outcome.NoSeedRelease);
  });
  it("is pending while the Episode deadline has not passed", () => {
    expect(at({ stakedAt: T, seedReleasedAt: T + 10, now: T + 10 + 299 })).toBeNull();
  });
  it("is No-show when no Episode Submission exists 5 min after Seed Release", () => {
    expect(at({ stakedAt: T, seedReleasedAt: T + 10, now: T + 10 + 301 })).toBe(Outcome.NoShow);
  });
  it("is No-show when the Episode Submission block timestamp is late", () => {
    expect(at({ stakedAt: T, seedReleasedAt: T + 10, episodeSubmittedAt: T + 10 + 301, now: T + 1000 })).toBe(Outcome.NoShow);
  });
  it("needs a Replay (null) when the Episode was submitted on time", () => {
    expect(at({ stakedAt: T, seedReleasedAt: T + 10, episodeSubmittedAt: T + 100, now: T + 1000 })).toBeNull();
  });
  it("does not blame the Requester when the Seed Release entity has expired but the Worker already submitted an Episode", () => {
    // Arkiv drops seedRelease shortly after the Episode deadline; a submission proves the Worker had the seed.
    expect(at({ stakedAt: T, episodeSubmittedAt: T + 100, now: T + 10_000 })).toBeNull();
  });

  describe("after the Seed Release entity may have expired", () => {
    it("is No-show when the submission is later than any on-time Seed Release would allow", () => {
      expect(at({ stakedAt: T, episodeSubmittedAt: T + 30 + 301, now: T + 10_000 })).toBe(Outcome.NoShow);
    });
    it("refuses to sign No Seed Release once an on-time Seed Release could have expired (it may be a No-show)", () => {
      expect(() => at({ stakedAt: T, now: T + SEED_RELEASE_VISIBLE + 1 })).toThrow(EvidenceExpiredError);
    });
    it("still signs No Seed Release while any Seed Release would still be visible", () => {
      expect(at({ stakedAt: T, now: T + SEED_RELEASE_VISIBLE })).toBe(Outcome.NoSeedRelease);
    });
  });

  describe("uses the Mission's on-chain windows, not the spec defaults", () => {
    const windows = { seedReleaseWindow: 60, episodeWindow: 900 };
    it("accepts a Seed Release inside a longer seedReleaseWindow", () => {
      expect(at({ stakedAt: T, seedReleasedAt: T + 45, episodeSubmittedAt: T + 100, now: T + 2000 }, windows)).toBeNull();
    });
    it("accepts a submission inside a longer episodeWindow", () => {
      expect(at({ stakedAt: T, seedReleasedAt: T + 10, episodeSubmittedAt: T + 10 + 800, now: T + 2000 }, windows)).toBeNull();
    });
    it("is No-show after a shorter episodeWindow", () => {
      expect(at({ stakedAt: T, seedReleasedAt: T + 10, now: T + 10 + 121 }, { seedReleaseWindow: 30, episodeWindow: 120 })).toBe(Outcome.NoShow);
    });
  });
});
