// When a Worker should not bid on a Mission. All amounts in USDC.
import type { Hex } from "../formats/episode-log";
import { toBaseUnits } from "../formats/usdc";
import { sameVerifierSet } from "../formats/verifier-set";

export const MIN_SECONDS_LEFT_TO_BID = 10;

export type SkipReason =
  | "UNTRUSTED_VERIFIERS"
  | "PRICE_NOT_POSITIVE"
  | "PRICE_ABOVE_MAX_BOUNTY"
  | "BIDDING_CLOSING"
  | "BUSY_WITH_UNFINISHED_WIN"
  | "WALLET_CANNOT_COVER_STAKE"
  | "ZG_BALANCE_CANNOT_COVER_EPISODE";

export interface SkipContext {
  /** The Mission's 3 Verifiers as the escrow stores them: the only keys whose signatures can Award or settle it. */
  missionVerifiers: readonly Hex[];
  /** This Worker's trusted Verifiers (VERIFIER_PUBKEYS / VERIFIER_ADDRESSES). */
  trustedVerifiers: readonly Hex[];
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
  /** The Mission's maxSteps: the most Decisions its Episode can take, so the worst-case 0G bill (ADR 0006). */
  maxSteps: number;
}

/** Returns the first reason to skip this Mission, or null if the Worker should bid. */
export function shouldSkip(context: SkipContext): SkipReason | null {
  // ADR 0005: Verifiers the Requester picked could sign a Fail after the stake and take it, so only the trusted set is safe.
  if (!sameVerifierSet(context.missionVerifiers, context.trustedVerifiers)) return "UNTRUSTED_VERIFIERS";
  // A Bid must be at least 1 base unit once converted; never bid 0, NaN or a negative price.
  if (!Number.isFinite(context.price) || context.price <= 0 || toBaseUnits(context.price) < 1n) return "PRICE_NOT_POSITIVE";
  if (context.price > context.maxBounty) return "PRICE_ABOVE_MAX_BOUNTY";
  if (context.secondsLeftToBid < MIN_SECONDS_LEFT_TO_BID) return "BIDDING_CLOSING";
  if (context.hasUnfinishedWin) return "BUSY_WITH_UNFINISHED_WIN";
  if (context.walletBalance < context.stake + context.txFees) return "WALLET_CANNOT_COVER_STAKE";
  if (context.zgBalance < context.zeroGPerDecision * context.maxSteps) return "ZG_BALANCE_CANNOT_COVER_EPISODE";
  return null;
}
