import { describe, expect, it } from "vitest";
import { shouldSkip, type SkipContext } from "../src/worker/skip";

const ok: SkipContext = {
  price: 1.36,
  maxBounty: 10,
  secondsLeftToBid: 45,
  hasUnfinishedWin: false,
  walletBalance: 5,
  stake: 0.5,
  txFees: 0.05,
  zgBalance: 5,
  costPerDecision: 0.05,
};

describe("shouldSkip", () => {
  it("bids when nothing is wrong", () => {
    expect(shouldSkip(ok)).toBeNull();
  });

  it.each<[string, Partial<SkipContext>, string]>([
    ["price above max bounty", { price: 10.01 }, "PRICE_ABOVE_MAX_BOUNTY"],
    ["under 10 s of bidding left", { secondsLeftToBid: 9 }, "BIDDING_CLOSING"],
    ["already holding an unfinished win", { hasUnfinishedWin: true }, "BUSY_WITH_UNFINISHED_WIN"],
    ["wallet can't cover stake + fees", { walletBalance: 0.54 }, "WALLET_CANNOT_COVER_STAKE"],
    ["0G balance can't cover the 60-Decision cap", { zgBalance: 2.99 }, "ZG_BALANCE_CANNOT_COVER_EPISODE"],
  ])("skips when %s", (_label, change, reason) => {
    expect(shouldSkip({ ...ok, ...change })).toBe(reason);
  });

  it("still bids at exactly the limits", () => {
    expect(shouldSkip({ ...ok, price: 10, secondsLeftToBid: 10, walletBalance: 0.55, zgBalance: 3 })).toBeNull();
  });
});
