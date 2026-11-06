import { concat, keccak256 } from "viem";
import type { Hex } from "./episode-log";

/** The public Seed Commitment for a Course Seed and its salt: keccak256(seed ‖ salt). */
export function seedCommitment(seed: Hex, salt: Hex): Hex {
  return keccak256(concat([seed, salt]));
}
