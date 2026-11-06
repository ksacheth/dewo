import { keccak256, toBytes } from "viem";
import type { Hex } from "./episode-log";
import { FRAME_PLACEHOLDER, HISTORY_PLACEHOLDER, RESERVED_REQUEST_FIELDS } from "./request";

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
  /**
   * Extra top-level fields merged into every request body, e.g. `{ "chat_template_kwargs": { "enable_thinking": false } }`
   * (ADR 0004). Part of the committed Policy, so a Verifier's request rebuild includes them. They can never replace
   * the fields buildRequest sets itself (RESERVED_REQUEST_FIELDS). Routing headers are not part of the body.
   */
  requestOptions?: Readonly<Record<string, unknown>>;
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
    problems.push(`${at}: providerAddress must be a real 0G provider address, not ${policy.providerAddress} (ADR 0004 pins 0xf4FB8d2bD856e672b5f9848b0eD235A20079B250)`);
  }
  if (typeof policy.model !== "string" || policy.model.trim() === "" || /^tbd\b/i.test(policy.model.trim())) {
    problems.push(`${at}: model is a placeholder (${JSON.stringify(policy.model)}); set a model id the provider serves (ADR 0004: 0gm-1.0-35b-a3b)`);
  }
  problems.push(...requestOptionsProblems(policy, at));
  return problems;
}

function requestOptionsProblems(policy: Policy, at: string): string[] {
  const options = policy.requestOptions;
  if (options === undefined) return [];
  if (options === null || typeof options !== "object" || Array.isArray(options)) return [`${at}: requestOptions must be a JSON object`];
  const reserved = Object.keys(options).filter((key) => (RESERVED_REQUEST_FIELDS as readonly string[]).includes(key));
  return reserved.map((key) => `${at}: requestOptions cannot set "${key}" (buildRequest sets it from the Policy)`);
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
    // Undefined fields are dropped, as JSON.stringify does, so `{ requestOptions: undefined }` hashes like an absent field.
    const entries = Object.keys(value as Record<string, unknown>)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
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
