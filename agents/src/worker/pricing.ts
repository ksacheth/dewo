// Demo Worker pricing strategy (docs/spec.md section 4.3). Not a protocol rule:
// the protocol only requires price <= maxBounty. All amounts in USDC.

export interface PricingInput {
  /** Estimated 0G cost of one Decision with this Worker's Policy. */
  costPerDecision: number;
  /** This Worker's own guess of Decisions for the Mission's Difficulty Class. */
  expectedDecisions: number;
  /** Stake tx, Bid write, two 0G Storage uploads, submitEpisode. */
  txFees: number;
  /** This Worker's current Reliability, between 0 and 1. */
  reliability: number;
  /** The Bid Stake it would have to post (computed by the public stake formula in @dewo/board). */
  stake: number;
  /** Personality markup, e.g. 1.6 for Careful. */
  margin: number;
}

/** What this Worker expects one Mission to cost it, including the stake it expects to lose. */
export function costEstimate(input: PricingInput): number {
  const inference = input.costPerDecision * input.expectedDecisions;
  const expectedStakeLoss = (1 - input.reliability) * input.stake;
  return inference + input.txFees + expectedStakeLoss;
}

/** The price this Worker bids: its cost estimate times its margin. */
export function price(input: PricingInput): number {
  return costEstimate(input) * input.margin;
}
