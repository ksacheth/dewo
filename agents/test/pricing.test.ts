import { describe, expect, it } from "vitest";
import { costEstimate, price, type PricingInput } from "../src/worker/pricing";

// The worked example from the design: Careful, R = 0.9, max bounty 10,
// stake = 10 x (1 - 0.9) x 0.5 = 0.5.
const careful: PricingInput = {
  costPerDecision: 0.05,
  expectedDecisions: 15,
  maxSteps: 60,
  txFees: 0.05,
  reliability: 0.9,
  stake: 0.5,
  margin: 1.6,
};

describe("pricing", () => {
  it("cost estimate = inference + tx fees + expected stake loss", () => {
    expect(costEstimate(careful)).toBeCloseTo(0.75 + 0.05 + 0.05, 10);
  });

  it("price = cost estimate x margin", () => {
    expect(price(careful)).toBeCloseTo(1.36, 10);
  });

  it("a perfectly reliable Worker expects to lose no stake", () => {
    expect(costEstimate({ ...careful, reliability: 1 })).toBeCloseTo(0.8, 10);
  });

  it("never prices more Decisions than the Mission's maxSteps allow", () => {
    expect(costEstimate({ ...careful, maxSteps: 10 })).toBeCloseTo(0.5 + 0.05 + 0.05, 10);
    expect(costEstimate({ ...careful, maxSteps: 15 })).toBeCloseTo(costEstimate(careful), 10);
  });

  it("does not include Replay fees (the Requester pays those)", () => {
    expect(Object.keys(careful)).not.toContain("replayFee");
  });
});
