import { describe, expect, it } from "vitest";
import { classifyTimeline } from "../src/deadlines.js";
import { Outcome } from "../src/sign.js";

// Spec section 3: Seed Release within 30 s of stake; Episode Submission within 5 min of Seed Release.
const T = 1_000;
describe("classifyTimeline", () => {
  it("is pending while the Seed Release deadline has not passed", () => {
    expect(classifyTimeline({ stakedAt: T, now: T + 29 })).toBeNull();
  });
  it("is No Seed Release when no Seed Release exists 30 s after stake", () => {
    expect(classifyTimeline({ stakedAt: T, now: T + 31 })).toBe(Outcome.NoSeedRelease);
  });
  it("is No Seed Release when the Seed Release landed after the deadline", () => {
    expect(classifyTimeline({ stakedAt: T, seedReleasedAt: T + 45, now: T + 60 })).toBe(Outcome.NoSeedRelease);
  });
  it("is pending while the Episode deadline has not passed", () => {
    expect(classifyTimeline({ stakedAt: T, seedReleasedAt: T + 10, now: T + 10 + 299 })).toBeNull();
  });
  it("is No-show when no Episode Submission exists 5 min after Seed Release", () => {
    expect(classifyTimeline({ stakedAt: T, seedReleasedAt: T + 10, now: T + 10 + 301 })).toBe(Outcome.NoShow);
  });
  it("is No-show when the Episode Submission block timestamp is late", () => {
    expect(classifyTimeline({ stakedAt: T, seedReleasedAt: T + 10, episodeSubmittedAt: T + 10 + 301, now: T + 1000 })).toBe(Outcome.NoShow);
  });
  it("needs a Replay (null) when the Episode was submitted on time", () => {
    expect(classifyTimeline({ stakedAt: T, seedReleasedAt: T + 10, episodeSubmittedAt: T + 100, now: T + 1000 })).toBeNull();
  });
  it("does not blame the Requester when the Seed Release entity has expired but the Worker already submitted an Episode", () => {
    // Arkiv drops seedRelease shortly after the Episode deadline; a submission proves the Worker had the seed.
    expect(classifyTimeline({ stakedAt: T, episodeSubmittedAt: T + 100, now: T + 10_000 })).toBeNull();
  });
});
