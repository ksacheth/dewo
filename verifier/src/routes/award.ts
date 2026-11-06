import { bidStake, pickWinner } from "@dewo/board";
import type { Address, Hex } from "viem";
import { NoValidBidsError } from "../errors.js";
import type { BoardPort, EscrowMission, EscrowPort, SealedBid } from "../ports.js";
import { signAward } from "../sign.js";

export interface AwardDeps { board: BoardPort; chain: EscrowPort; key: Hex; escrow: Address; now: () => number }
export interface SignedAward { worker: Address; price: bigint; stake: bigint; signature: Hex }

/** Open one Bid and read its Worker's Reliability, or null when the Bid cannot compete (garbage, or priced above maxBounty). */
async function openCandidate(board: BoardPort, bid: SealedBid, maxBounty: bigint) {
  let price: bigint;
  try {
    price = await board.openBid(bid, maxBounty);
  } catch {
    return null;
  }
  return { key: bid.key, worker: bid.worker, price, R: await board.reliabilityOf(bid.worker) };
}

/** Open every eligible Bid, rank them with the board's public rule (`pickWinner`), and sign the Award for the best one. */
async function signBestAward(deps: AwardDeps, missionId: Hex, { mission }: EscrowMission, bids: SealedBid[], excluded: Set<string>): Promise<SignedAward> {
  const eligible = bids.filter((bid) => !excluded.has(bid.worker.toLowerCase()));
  const opened = await Promise.all(eligible.map((bid) => openCandidate(deps.board, bid, mission.maxBounty)));
  const candidates = opened.filter((c) => c !== null);
  if (candidates.length === 0) throw new NoValidBidsError(`no valid bids for mission ${missionId}`);

  // pickWinner is the one tie-break all three Verifiers share (score, then lower price, then lower Bid key).
  const best = pickWinner(candidates, mission.riskWeight);
  const stake = bidStake(mission.maxBounty, best.R);
  const signature = await signAward(deps.key, deps.escrow, { missionId, worker: best.worker, price: best.price, stake });
  return { worker: best.worker, price: best.price, stake, signature };
}

/** Workers that may not win again: a replacement Award was already made over them, or their stake window has run out unstaked. */
async function lapsedWorkers(deps: AwardDeps, missionId: Hex, escrowMission: EscrowMission, bids: SealedBid[]): Promise<Set<string>> {
  const flags = await Promise.all(bids.map((bid) => deps.chain.isLapsed(missionId, bid.worker)));
  const lapsed = new Set(bids.filter((_, i) => flags[i]).map((bid) => bid.worker.toLowerCase()));
  const { award } = escrowMission;
  if (award && award.stakedAt === null && deps.now() > award.awardedAt + award.stakeWindow) lapsed.add(award.worker.toLowerCase());
  return lapsed;
}

/**
 * POST /award. The Requester only sends a Mission id, so lapsed winners are read from the chain: every Verifier sees the same
 * Awards and therefore skips the same Workers. An instance never re-signs a different Award for a Mission unless the
 * winner has lapsed (the Quorum needs 2 matching signatures, even if Verdict history moves between calls). The in-memory
 * cache covers the window before the Award lands on-chain; after that the escrow's stored terms are re-signed, so a
 * restarted instance still agrees with the Quorum.
 */
export function createAwarder(deps: AwardDeps): (missionId: Hex) => Promise<SignedAward> {
  const signed = new Map<Hex, SignedAward>();
  return async (missionId) => {
    const escrowMission = await deps.chain.getMission(missionId);
    const bids = await deps.board.listBids(missionId);
    const lapsed = await lapsedWorkers(deps, missionId, escrowMission, bids);
    // The Award already on-chain is the Quorum's decision: re-sign exactly its terms rather than re-ranking.
    const onChain = escrowMission.award;
    if (onChain && !lapsed.has(onChain.worker.toLowerCase())) {
      const { worker, price, stake } = onChain;
      const award = { worker, price, stake, signature: await signAward(deps.key, deps.escrow, { missionId, worker, price, stake }) };
      signed.set(missionId, award);
      return award;
    }
    const cached = signed.get(missionId);
    if (cached && !lapsed.has(cached.worker.toLowerCase())) return cached;

    const award = await signBestAward(deps, missionId, escrowMission, bids, lapsed);
    signed.set(missionId, award);
    return award;
  };
}
