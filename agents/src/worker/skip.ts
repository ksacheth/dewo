// When a Worker should not bid on a Mission. All amounts in USDC.
import { DECISION_CAP } from "../formats/path";

export const MIN_SECONDS_LEFT_TO_BID = 10;

export type SkipReason =
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
  costPerDecision: number;
}

/** Returns the first reason to skip this Mission, or null if the Worker should bid. */
export function shouldSkip(context: SkipContext): SkipReason | null {
  if (context.price > context.maxBounty) return "PRICE_ABOVE_MAX_BOUNTY";
  if (context.secondsLeftToBid < MIN_SECONDS_LEFT_TO_BID) return "BIDDING_CLOSING";
  if (context.hasUnfinishedWin) return "BUSY_WITH_UNFINISHED_WIN";
  if (context.walletBalance < context.stake + context.txFees) return "WALLET_CANNOT_COVER_STAKE";
  if (context.zgBalance < context.costPerDecision * DECISION_CAP) return "ZG_BALANCE_CANNOT_COVER_EPISODE";
  return null;
}
