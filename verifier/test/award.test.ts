import { describe, expect, it } from "vitest";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { computeAward } from "../src/routes/award.js";
import type { BoardPort, VerdictRecord } from "../src/ports.js";
import { Outcome, awardTypes, eip712Domain } from "../src/sign.js";

const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const ESCROW = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const;
const MISSION = ("0x" + "11".repeat(32)) as Hex;
const ROOKIE = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const VETERAN = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;
const USDC = 1_000_000n;

function board(opts: { prices: Record<Address, bigint>; verdicts?: Record<Address, VerdictRecord[]>; riskWeight?: number }): BoardPort {
  return {
    getMission: async () => ({ missionId: MISSION, riskWeight: opts.riskWeight ?? 0.5, maxBounty: 10n * USDC, seedCommitment: "0x00", stepBudget: 15, difficultyClass: "medium" }),
    listBids: async () => Object.keys(opts.prices).map((worker) => ({ worker: worker as Address, policyHash: "0x00" as Hex })),
    openBid: async (bid) => opts.prices[bid.worker]!,
    listVerdicts: async (w) => opts.verdicts?.[w] ?? [],
  };
}
const passes = (worker: Address, n: number): VerdictRecord[] =>
  Array.from({ length: n }, (_, i) => ({ worker, outcome: Outcome.Pass, timestamp: i }));

describe("computeAward", () => {
  it("lets an underpricing rookie beat a veteran at risk weight 0.5 (spec 4.2)", async () => {
    const award = await computeAward(
      { board: board({ prices: { [ROOKIE]: 5n * USDC, [VETERAN]: 10n * USDC }, verdicts: { [VETERAN]: passes(VETERAN, 10) } }), key: KEY, escrow: ESCROW },
      MISSION,
    );
    expect(award.worker).toBe(ROOKIE);
    expect(award.price).toBe(5n * USDC);
  });

  it("signs the Bid Stake (maxBounty x (1 - R) x 0.5): a rookie stakes about 1.67 USDC of 10", async () => {
    const award = await computeAward(
      { board: board({ prices: { [ROOKIE]: 5n * USDC } }), key: KEY, escrow: ESCROW }, MISSION,
    );
    // R = 2/3 for a worker with no history -> 10 * (1/3) * 0.5 = 1.6666..
    expect(award.stake).toBe(1_666_666n);
    const signer = await recoverTypedDataAddress({
      domain: eip712Domain(ESCROW), types: awardTypes, primaryType: "Award",
      message: { missionId: MISSION, worker: ROOKIE, price: award.price, stake: award.stake },
      signature: award.signature,
    });
    expect(signer).toBe(privateKeyToAccount(KEY).address);
  });

  it("breaks exact score ties by lowest address so all three Verifiers sign the same Award", async () => {
    const prices = { [ROOKIE]: 5n * USDC, [VETERAN]: 5n * USDC };
    const a = await computeAward({ board: board({ prices }), key: KEY, escrow: ESCROW }, MISSION);
    expect(a.worker).toBe(ROOKIE.toLowerCase() < VETERAN.toLowerCase() ? ROOKIE : VETERAN);
  });

  it("skips a Bid whose price cannot be opened instead of failing the whole Award", async () => {
    const b = board({ prices: { [ROOKIE]: 5n * USDC, [VETERAN]: 1n * USDC } });
    const award = await computeAward(
      { board: { ...b, openBid: async (bid) => { if (bid.worker === VETERAN) throw new Error("bad ciphertext"); return b.openBid(bid); } }, key: KEY, escrow: ESCROW },
      MISSION,
    );
    expect(award.worker).toBe(ROOKIE);
  });

  it("rejects when no Bid can be opened", async () => {
    await expect(computeAward({ board: board({ prices: {} }), key: KEY, escrow: ESCROW }, MISSION)).rejects.toThrow(/no valid bids/);
  });

  it("drops a Bid priced above the Mission's max bounty, which Escrow could never pay", async () => {
    const award = await computeAward(
      { board: board({ prices: { [ROOKIE]: 11n * USDC, [VETERAN]: 10n * USDC }, verdicts: { [ROOKIE]: passes(ROOKIE, 20) } }), key: KEY, escrow: ESCROW }, MISSION,
    );
    expect(award.worker).toBe(VETERAN);
  });

  it("awards the next-best Bid when the winner is excluded (stake deadline lapsed)", async () => {
    const award = await computeAward(
      { board: board({ prices: { [ROOKIE]: 5n * USDC, [VETERAN]: 10n * USDC } }), key: KEY, escrow: ESCROW }, MISSION, { exclude: [ROOKIE] },
    );
    expect(award.worker).toBe(VETERAN);
  });
});
