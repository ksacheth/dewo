import { keccak256, toBytes } from "viem";
import type { Hex } from "./episode-log";
import { FRAME_PLACEHOLDER, HISTORY_PLACEHOLDER } from "./request";

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

/** Everything wrong with a Policy that would make a Worker unable to fly with it, as readable sentences. */
export function policyProblems(policy: Policy): string[] {
  const problems: string[] = [];
  const at = `Policy "${policy.name}"`;
  for (const placeholder of [FRAME_PLACEHOLDER, HISTORY_PLACEHOLDER]) {
    if (typeof policy.promptTemplate !== "string" || !policy.promptTemplate.includes(placeholder)) {
      problems.push(`${at}: promptTemplate has no ${placeholder} placeholder`);
    }
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(policy.providerAddress) || /^0x0{40}$/.test(policy.providerAddress)) {
    problems.push(`${at}: providerAddress must be a real 0G provider address, not ${policy.providerAddress} (fill it in during testnet setup)`);
  }
  if (typeof policy.model !== "string" || policy.model.trim() === "" || /^tbd\b/i.test(policy.model.trim())) {
    problems.push(`${at}: model is a placeholder (${JSON.stringify(policy.model)}); set a model id the provider serves (fill it in during testnet setup)`);
  }
  return problems;
}

/** Throws with every problem at once; run at Worker startup so a half-filled demo Policy never reaches a Bid. */
export function assertUsablePolicy(policy: Policy): void {
  const problems = policyProblems(policy);
  if (problems.length > 0) throw new Error(`unusable Policy:\n- ${problems.join("\n- ")}`);
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
