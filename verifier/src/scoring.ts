import { Outcome } from "./sign.js";
import type { VerdictRecord } from "./ports.js";

// Local copy of spec section 4 formulas; replaced by @dewo/board's pure scoring at integration.
const ALPHA = 2;
const BETA = 1;
const LAMBDA = 0.9;

/** Reliability (spec 4.1): recent-weighted, smoothed pass rate. Invalid Course and No Seed Release are excluded. */
export function reliability(verdicts: VerdictRecord[]): number {
  const counted = verdicts
    .filter((v) => v.outcome !== Outcome.InvalidCourse && v.outcome !== Outcome.NoSeedRelease)
    .sort((a, b) => b.timestamp - a.timestamp); // most recent first (i = 0)
  let weightSum = 0;
  let passSum = 0;
  counted.forEach((v, i) => {
    const weight = LAMBDA ** i;
    weightSum += weight;
    if (v.outcome === Outcome.Pass) passSum += weight;
  });
  return (ALPHA + passSum) / (ALPHA + BETA + weightSum);
}

/** Award score (spec 4.2): S = R^w / price^(1-w). Price is in any consistent unit. */
export function awardScore(r: number, price: number, riskWeight: number): number {
  return r ** riskWeight / price ** (1 - riskWeight);
}

/** Bid Stake (spec 4.3): maxBounty x (1 - R) x 0.5, rounded down to base units. */
export function bidStake(maxBounty: bigint, r: number): bigint {
  return BigInt(Math.floor(Number(maxBounty) * (1 - r) * 0.5));
}
