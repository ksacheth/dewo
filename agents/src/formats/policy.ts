import { keccak256, toBytes } from "viem";
import type { Hex } from "./episode-log";

// I2: a Worker's fixed recipe for piloting, committed by hash in its Bid.
export interface Policy {
  name: string;
  /** 0G model id. */
  model: string;
  providerAddress: Hex;
  /** Must contain the {{frame}} and {{history}} placeholders. */
  promptTemplate: string;
  /** How many past Decisions are fed back into {{history}}. */
  memoryWindow: number;
  /** 0 for every demo Policy, to keep answers as repeatable as 0G allows. */
  temperature: number;
  version: string;
}

/**
 * JSON with object keys sorted at every level and no whitespace.
 * Two Policies with the same content always produce the same string,
 * whatever order their keys were written in.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The Policy fingerprint posted in a Bid: keccak256 of its canonical JSON. */
export function policyHash(policy: Policy): Hex {
  return keccak256(toBytes(canonicalJson(policy)));
}
