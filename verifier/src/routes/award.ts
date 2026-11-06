import { bidStake, pickWinner } from "@dewo/board";
import type { Address, Hex } from "viem";
import { NoValidBidsError } from "../errors.js";
import type { BoardPort, EscrowMission, EscrowPort, SealedBid } from "../ports.js";
import { signAward } from "../sign.js";

export interface AwardDeps { board: BoardPort; chain: EscrowPort; key: Hex; escrow: Address; now: () => number }
export interface SignedAward { worker: Address; price: bigint; stake: bigint; signature: Hex }

/** Open every eligible Bid, rank them with the board's public rule (`pickWinner`), and sign the Award for the best one. */
async function signBestAward(deps: AwardDeps, missionId: Hex, { mission }: EscrowMission, bids: SealedBid[], excluded: Set<string>): Promise<SignedAward> {
  const candidates = [];
  for (const bid of bids) {
    if (excluded.has(bid.worker.toLowerCase())) continue;
    let price: bigint;
    try {
      price = await deps.board.openBid(bid, mission.maxBounty); // rejects garbage and prices above maxBounty
    } catch {
      continue; // this Bid cannot compete
    }
    candidates.push({ key: bid.key, worker: bid.worker, price, R: await deps.board.reliabilityOf(bid.worker) });
  }
  if (candidates.length === 0) throw new NoValidBidsError(`no valid bids for mission ${missionId}`);

  // pickWinner is the one tie-break all three Verifiers share (score, then lower price, then lower Bid key).
  const best = pickWinner(candidates, mission.riskWeight);
  const stake = bidStake(mission.maxBounty, best.R);
  const signature = await signAward(deps.key, deps.escrow, { missionId, worker: best.worker, price: best.price, stake });
  return { worker: best.worker, price: best.price, stake, signature };
}

/** Workers that may not win again: a replacement Award was already made over them, or their stake window has run out unstaked. */
async function lapsedWorkers(deps: AwardDeps, missionId: Hex, escrowMission: EscrowMission, bids: SealedBid[]): Promise<Set<string>> {
  const lapsed = new Set<string>();
  for (const bid of bids) {
    if (await deps.chain.isLapsed(missionId, bid.worker)) lapsed.add(bid.worker.toLowerCase());
  }
  const { award } = escrowMission;
  if (award && award.stakedAt === null && deps.now() > award.awardedAt + award.stakeWindow) lapsed.add(award.worker.toLowerCase());
  return lapsed;
}

/**
 * POST /award. The Requester only sends a Mission id, so lapsed winners are read from the chain: every Verifier sees the same
 * Awards and therefore skips the same Workers. An instance never re-signs a different Award for a Mission unless the
 * winner it signed has lapsed (the Quorum needs 2 matching signatures, even if Verdict history moves between calls).
 */
export function createAwarder(deps: AwardDeps): (missionId: Hex) => Promise<SignedAward> {
  const signed = new Map<Hex, SignedAward>();
  return async (missionId) => {
    const escrowMission = await deps.chain.getMission(missionId);
    const bids = await deps.board.listBids(missionId);
    const lapsed = await lapsedWorkers(deps, missionId, escrowMission, bids);
    const cached = signed.get(missionId);
    if (cached && !lapsed.has(cached.worker.toLowerCase())) return cached;
    const award = await signBestAward(deps, missionId, escrowMission, bids, lapsed);
    signed.set(missionId, award);
    return award;
  };
}
