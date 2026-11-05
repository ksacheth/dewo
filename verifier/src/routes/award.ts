import type { Address, Hex } from "viem";
import type { BoardPort } from "../ports.js";
import { awardScore, bidStake, reliability } from "../scoring.js";
import { signAward } from "../sign.js";

export interface AwardDeps { board: BoardPort; key: Hex; escrow: Address }
export interface SignedAward { worker: Address; price: bigint; stake: bigint; signature: Hex }

/** Open every Bid, score it with the public rule, and sign the Award for the best one. */
export async function computeAward(deps: AwardDeps, missionId: Hex): Promise<SignedAward> {
  const { board } = deps;
  const mission = await board.getMission(missionId);
  const bids = await board.listBids(missionId);

  const scored = [];
  for (const bid of bids) {
    let price: bigint;
    try {
      price = await board.openBid(bid);
    } catch {
      continue; // malformed ciphertext: this Bid cannot compete
    }
    if (price <= 0n) continue;
    const r = reliability(await board.listVerdicts(bid.worker));
    scored.push({ worker: bid.worker, price, r, score: awardScore(r, Number(price), mission.riskWeight) });
  }
  const best = scored.sort(
    // Deterministic tie-break so every Verifier signs the same Award: score, then lower price, then lower address.
    (a, b) => b.score - a.score || Number(a.price - b.price) || (a.worker.toLowerCase() < b.worker.toLowerCase() ? -1 : 1),
  )[0];
  if (!best) throw new Error(`no valid bids for mission ${missionId}`);

  const stake = bidStake(mission.maxBounty, best.r);
  const signature = await signAward(deps.key, deps.escrow, { missionId, worker: best.worker, price: best.price, stake });
  return { worker: best.worker, price: best.price, stake, signature };
}
