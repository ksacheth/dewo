import { concat, keccak256, type Hex } from "viem";

/** Check 1: H(seed ‖ salt) equals the Mission's seedCommitment. */
export const seedMatchesCommitment = (seed: Hex, salt: Hex, commitment: Hex): boolean =>
  keccak256(concat([seed, salt])).toLowerCase() === commitment.toLowerCase();
