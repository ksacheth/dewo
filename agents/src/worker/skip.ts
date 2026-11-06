// When a Worker should not bid on a Mission. All amounts in USDC.
import { DECISION_CAP } from "../formats/path";
import { toBaseUnits } from "../formats/usdc";

export const MIN_SECONDS_LEFT_TO_BID = 10;

export type SkipReason =
  | "PRICE_NOT_POSITIVE"
  | "PRICE_ABOVE_MAX_BOUNTY"
  | "BIDDING_CLOSING"
  | "BUSY_WITH_UNFINISHED_WIN"
  | "WALLET_CANNOT_COVER_STAKE"
  | "ZG_BALANCE_CANNOT_COVER_EPISODE";

export interface SkipContext {
  price: number;
  maxBounty: number;
  secondsLeftToBid: number;
  hasUnfinishedWin: boolean;
  walletBalance: number;
  stake: number;
  txFees: number;
  zgBalance: number;
  /** 0G cost of one Decision, in the unit of zgBalance. */
  zeroGPerDecision: number;
}

/** Returns the first reason to skip this Mission, or null if the Worker should bid. */
export function shouldSkip(context: SkipContext): SkipReason | null {
  // A Bid must be at least 1 base unit once converted; never bid 0, NaN or a negative price.
  if (!Number.isFinite(context.price) || context.price <= 0 || toBaseUnits(context.price) < 1n) return "PRICE_NOT_POSITIVE";
  if (context.price > context.maxBounty) return "PRICE_ABOVE_MAX_BOUNTY";
  if (context.secondsLeftToBid < MIN_SECONDS_LEFT_TO_BID) return "BIDDING_CLOSING";
  if (context.hasUnfinishedWin) return "BUSY_WITH_UNFINISHED_WIN";
  if (context.walletBalance < context.stake + context.txFees) return "WALLET_CANNOT_COVER_STAKE";
  if (context.zgBalance < context.zeroGPerDecision * DECISION_CAP) return "ZG_BALANCE_CANNOT_COVER_EPISODE";
  return null;
}
