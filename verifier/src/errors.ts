/** The Mission is not ready for a Verdict yet (no stake, or no submission inside the Episode window). Callers should retry later. */
export class PendingError extends Error {}

/** No Bid can win: none was placed, every price was malformed or above maxBounty, or every bidder lapsed. The Requester treats this as "no Award". */
export class NoValidBidsError extends Error {}

/** The bidding window has not closed (`now < biddingEndsAt`): no Award can be signed yet. Callers should retry after it closes. */
export class BiddingOpenError extends Error {}

/**
 * 0G Storage could not be reached: the indexer or network is down, or a download timed out. This is infrastructure, never the
 * Worker's fault, so no Verdict is signed. The Requester can retry; if 0G stays down, the Mission ends in `MissionEscrow.rescue`.
 */
export class StorageUnavailableError extends Error {}

/**
 * ADR 0005: the Mission's on-chain Verifiers are not this Verifier's trusted `VERIFIER_ADDRESSES` (or do not include this
 * Verifier). Two keys the Requester or a Worker controls could settle such a Mission alone, so this Verifier signs nothing for it.
 * Retrying cannot help: the Verifiers are fixed at `createMission`.
 */
export class UntrustedVerifiersError extends Error {}

/**
 * Galileo's head is not yet far enough past the upload window for the Flow scan to be trusted (a finality wait). It carries the
 * unix second the wait ends, so the answer to the Requester can say when to come back without anyone parsing the message.
 */
export class FinalityPendingError extends Error {
  constructor(message: string, readonly readyAt: number) {
    super(message);
    this.name = "FinalityPendingError";
  }
}
