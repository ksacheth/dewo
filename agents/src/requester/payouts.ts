import type { Outcome } from "./ports";

/** Who gets what at settle(), by the spec's Outcome table. USDC base units. */
export function payouts(outcome: Outcome, maxBounty: bigint, price: bigint, stake: bigint): { worker: bigint; requester: bigint } {
  if (outcome === "Fail" || outcome === "NoShow") return { worker: 0n, requester: maxBounty + stake };
  return { worker: price + stake, requester: maxBounty - price };
}
