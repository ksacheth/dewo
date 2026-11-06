import { describe, expect, it } from "vitest";
import type { Hex } from "../src/formats";
import { shouldSkip, type SkipContext } from "../src/worker/skip";

const TRUSTED: Hex[] = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
];
const FOREIGN: Hex = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";

const ok: SkipContext = {
  missionVerifiers: TRUSTED,
  trustedVerifiers: TRUSTED,
  price: 1.36,
  maxBounty: 10,
  secondsLeftToBid: 45,
  hasUnfinishedWin: false,
  walletBalance: 5,
  stake: 0.5,
  txFees: 0.05,
  zgBalance: 5,
  zeroGPerDecision: 0.05,
  maxSteps: 60,
};

describe("shouldSkip", () => {
  it("bids when nothing is wrong", () => {
    expect(shouldSkip(ok)).toBeNull();
  });

  it.each<[string, Partial<SkipContext>, string]>([
    ["one on-chain Verifier is not trusted", { missionVerifiers: [TRUSTED[0]!, TRUSTED[1]!, FOREIGN] }, "UNTRUSTED_VERIFIERS"],
    ["two on-chain Verifiers are not trusted", { missionVerifiers: [TRUSTED[0]!, FOREIGN, FOREIGN] }, "UNTRUSTED_VERIFIERS"],
    ["the Mission names only 2 Verifiers", { missionVerifiers: TRUSTED.slice(0, 2) }, "UNTRUSTED_VERIFIERS"],
    ["price is zero", { price: 0 }, "PRICE_NOT_POSITIVE"],
    ["price rounds to zero base units", { price: 0.0000004 }, "PRICE_NOT_POSITIVE"],
    ["price is NaN", { price: Number.NaN }, "PRICE_NOT_POSITIVE"],
    ["price is infinite", { price: Number.POSITIVE_INFINITY }, "PRICE_NOT_POSITIVE"],
    ["price is negative", { price: -1 }, "PRICE_NOT_POSITIVE"],
    ["price above max bounty", { price: 10.01 }, "PRICE_ABOVE_MAX_BOUNTY"],
    ["under 10 s of bidding left", { secondsLeftToBid: 9 }, "BIDDING_CLOSING"],
    ["already holding an unfinished win", { hasUnfinishedWin: true }, "BUSY_WITH_UNFINISHED_WIN"],
    ["wallet can't cover stake + fees", { walletBalance: 0.54 }, "WALLET_CANNOT_COVER_STAKE"],
    ["0G balance can't cover the Mission's 60 maxSteps Decisions", { zgBalance: 2.99 }, "ZG_BALANCE_CANNOT_COVER_EPISODE"],
    ["0G balance can't cover a Mission with more maxSteps", { zgBalance: 4, maxSteps: 100 }, "ZG_BALANCE_CANNOT_COVER_EPISODE"],
  ])("skips when %s", (_label, change, reason) => {
    expect(shouldSkip({ ...ok, ...change })).toBe(reason);
  });

  it("bids when the Mission names the trusted Verifiers in another order and case", () => {
    const shuffled = [TRUSTED[2]!.toLowerCase(), TRUSTED[0]!.toUpperCase().replace("0X", "0x"), TRUSTED[1]!] as Hex[];
    expect(shouldSkip({ ...ok, missionVerifiers: shuffled })).toBeNull();
  });

  it("checks the Verifiers before anything else", () => {
    expect(shouldSkip({ ...ok, missionVerifiers: [FOREIGN, TRUSTED[1]!, TRUSTED[2]!], price: 0, hasUnfinishedWin: true })).toBe("UNTRUSTED_VERIFIERS");
  });

  it("still bids at the smallest payable price, 1 base unit", () => {
    expect(shouldSkip({ ...ok, price: 0.000001 })).toBeNull();
  });

  it("still bids at exactly the limits", () => {
    expect(shouldSkip({ ...ok, price: 10, secondsLeftToBid: 10, walletBalance: 0.55, zgBalance: 3 })).toBeNull();
  });
});
