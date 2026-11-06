import type { Hex } from "viem";
import { policyHash, type Policy } from "@dewo/agents/formats";

/** Check 3: the revealed Policy hashes to the Bid's committed policyHash. */
export const policyMatchesBid = (policy: Policy, committed: Hex): boolean =>
  policyHash(policy).toLowerCase() === committed.toLowerCase();
