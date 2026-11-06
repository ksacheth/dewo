import { seedCommitment, type Hex } from "@dewo/agents/formats";

/** Check 1: H(seed ‖ salt) equals the Mission's seedCommitment. */
export const seedMatchesCommitment = (seed: Hex, salt: Hex, commitment: Hex): boolean =>
  seedCommitment(seed, salt).toLowerCase() === commitment.toLowerCase();
