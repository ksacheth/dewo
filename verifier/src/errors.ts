/** The Mission is not ready for a Verdict yet (no stake, no submission, no revealed seed). Callers should retry later. */
export class PendingError extends Error {}

/**
 * The evidence a deadline Outcome rests on has expired (e.g. the Seed Release entity on Arkiv), so no Verifier can sign one
 * safely. Retrying will not help; the Mission falls back to `MissionEscrow.rescue`, which refunds both sides.
 */
export class EvidenceExpiredError extends Error {}

/** No Bid can win: none was placed, every price was malformed or above maxBounty, or every bidder lapsed. The Requester treats this as "no Award". */
export class NoValidBidsError extends Error {}

/** The bidding window has not closed (`now < biddingEndsAt`): no Award can be signed yet. Callers should retry after it closes. */
export class BiddingOpenError extends Error {}

/**
 * 0G Storage could not be reached: the indexer or network is down, or a download timed out. This is infrastructure, never the
 * Worker's fault, so no Verdict is signed. The Requester can retry; if 0G stays down, the Mission ends in `MissionEscrow.rescue`.
 */
export class StorageUnavailableError extends Error {}
