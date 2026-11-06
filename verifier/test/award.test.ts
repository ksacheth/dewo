import { describe, expect, it } from "vitest";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { NoValidBidsError } from "../src/errors.js";
import { createAwarder } from "../src/routes/award.js";
import { awardTypes, eip712Domain } from "../src/sign.js";
import { MISSION, OTHER_WORKER as VETERAN, WORKER as ROOKIE, bidKey, fakeBoard, fakeChain } from "./fixtures/builders.js";

const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const ESCROW = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const;
const USDC = 1_000_000n;

const awarder = (board: ReturnType<typeof fakeBoard>, chain = fakeChain(), now = () => 5_000) =>
  createAwarder({ board, chain, key: KEY, escrow: ESCROW, now });

describe("award (spec 4.2, ranked with the board's scoring)", () => {
  it("lets an underpricing rookie beat a veteran at risk weight 0.5", async () => {
    const award = await awarder(fakeBoard({ prices: { [ROOKIE]: 5n * USDC, [VETERAN]: 10n * USDC }, reliability: { [VETERAN]: 0.95 } }))(MISSION);
    expect(award.worker).toBe(ROOKIE);
    expect(award.price).toBe(5n * USDC);
  });

  it("signs the Bid Stake in integer USDC base units: a rookie (R = 2/3) stakes 1.666665 of 10", async () => {
    const award = await awarder(fakeBoard({ prices: { [ROOKIE]: 5n * USDC } }))(MISSION);
    expect(award.stake).toBe(1_666_665n); // board bidStake: floor(maxBounty x (1 - R) x 0.5), with (1 - R) fixed-point at 1e6
    const signer = await recoverTypedDataAddress({
      domain: eip712Domain(ESCROW), types: awardTypes, primaryType: "Award",
      message: { missionId: MISSION, worker: ROOKIE, price: award.price, stake: award.stake },
      signature: award.signature,
    });
    expect(signer).toBe(privateKeyToAccount(KEY).address);
  });

  it("breaks exact score ties by the lower Bid key, like every other Verifier", async () => {
    const award = await awarder(fakeBoard({ prices: { [ROOKIE]: 5n * USDC, [VETERAN]: 5n * USDC } }))(MISSION);
    expect(award.worker).toBe(bidKey(ROOKIE) < bidKey(VETERAN) ? ROOKIE : VETERAN);
  });

  it("skips a Bid whose price cannot be opened instead of failing the whole Award", async () => {
    const award = await awarder(fakeBoard({ prices: { [ROOKIE]: 5n * USDC, [VETERAN]: 1n * USDC }, unopenable: [VETERAN] }))(MISSION);
    expect(award.worker).toBe(ROOKIE);
  });

  it("drops a Bid priced above the on-chain max bounty, which Escrow could never pay", async () => {
    const award = await awarder(fakeBoard({ prices: { [ROOKIE]: 11n * USDC, [VETERAN]: 10n * USDC }, reliability: { [ROOKIE]: 0.99 } }))(MISSION);
    expect(award.worker).toBe(VETERAN);
  });

  it("scores against the on-chain risk weight: at w = 1 only Reliability counts, at w = 0 only price", async () => {
    const board = fakeBoard({ prices: { [ROOKIE]: 1n * USDC, [VETERAN]: 9n * USDC }, reliability: { [VETERAN]: 0.95 } });
    expect((await awarder(board, fakeChain({ riskWeight: 1 }))(MISSION)).worker).toBe(VETERAN);
    expect((await awarder(board, fakeChain({ riskWeight: 0 }))(MISSION)).worker).toBe(ROOKIE);
  });

  it("throws NoValidBidsError when nobody can win", async () => {
    await expect(awarder(fakeBoard({ prices: {} }))(MISSION)).rejects.toBeInstanceOf(NoValidBidsError);
  });
});

describe("award fallback after a lapsed stake window", () => {
  const prices = { [ROOKIE]: 5n * USDC, [VETERAN]: 5n * USDC };
  const firstWinner = async () => (await awarder(fakeBoard({ prices }))(MISSION)).worker;
  const unstaked = (worker: string, awardedAt = 5_000) => () => ({ worker: worker as typeof ROOKIE, awardedAt, stakeWindow: 30, stakedAt: null });

  it("keeps returning the same Award while the winner still has time to stake", async () => {
    const first = await firstWinner();
    let now = 5_000;
    const ask = awarder(fakeBoard({ prices }), fakeChain({ award: unstaked(first) }), () => now);
    const initial = await ask(MISSION);
    now = 5_030; // the last second of the stake window
    expect(await ask(MISSION)).toEqual(initial);
  });

  it("skips a winner whose stake window ran out unstaked and awards the next-best Bid", async () => {
    const first = await firstWinner();
    const second = first === ROOKIE ? VETERAN : ROOKIE;
    let now = 5_000;
    const ask = awarder(fakeBoard({ prices }), fakeChain({ award: unstaked(first) }), () => now);
    expect((await ask(MISSION)).worker).toBe(first);
    now = 5_031;
    expect((await ask(MISSION)).worker).toBe(second);
  });

  it("never skips a winner who staked, even long after the window", async () => {
    const first = await firstWinner();
    let now = 5_000;
    const ask = awarder(fakeBoard({ prices }), fakeChain({ award: () => ({ worker: first as typeof ROOKIE, awardedAt: 5_000, stakeWindow: 30, stakedAt: 5_010 }) }), () => now);
    await ask(MISSION);
    now = 9_000;
    expect((await ask(MISSION)).worker).toBe(first);
  });

  it("reads earlier lapses from the chain, so a restarted Verifier still excludes them", async () => {
    const first = await firstWinner();
    const second = first === ROOKIE ? VETERAN : ROOKIE;
    // A fresh instance has no memory: the escrow says `first` already lapsed and `second` holds the current Award, unstaked and out of time.
    const ask = awarder(fakeBoard({ prices }), fakeChain({ lapsed: [first], award: unstaked(second) }), () => 5_100);
    await expect(ask(MISSION)).rejects.toBeInstanceOf(NoValidBidsError); // both lapsed: nobody is left
  });
});
