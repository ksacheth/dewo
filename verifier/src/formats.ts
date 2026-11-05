import { keccak256, toBytes, type Hex } from "viem";
import type { Action } from "./ports.js";

// Local stand-ins for the I2/I3 formats. Replaced by imports from @dewo/agents/formats (M4) at integration.

export interface Policy {
  name: string;
  model: string;
  providerAddress: string;
  promptTemplate: string; // contains {{frame}} and {{history}}
  memoryWindow: number;
  version: string;
}
export interface Decision {
  step: number;
  frameHash: Hex;
  chatID: string;
  providerAddress: `0x${string}`;
  request: unknown;
  rawResponse: string;
  action: Action;
}
export interface EpisodeLog {
  header: { missionId: Hex; worker: `0x${string}`; policyRoot: Hex; seedCommitment: Hex };
  decisions: Decision[];
}

const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`
      : JSON.stringify(v);

/** policyHash = keccak256(canonical JSON, keys sorted, no whitespace) (I2). */
export const policyHash = (policy: Policy): Hex => keccak256(toBytes(canonical(policy)));
export const canonicalJson = canonical;

const ACTIONS: Action[] = ["FORWARD", "TURN_LEFT", "TURN_RIGHT", "STOP"];
/** Parse one Action out of a raw model response: the first action word that appears. */
export function parseAction(rawResponse: string): Action | null {
  const upper = rawResponse.toUpperCase();
  let best: { a: Action; i: number } | null = null;
  for (const a of ACTIONS) {
    const i = upper.indexOf(a);
    if (i >= 0 && (!best || i < best.i)) best = { a, i };
  }
  return best?.a ?? null;
}

/** Rebuild the request body a Worker following `policy` must have sent for this frame and history. */
export function buildRequest(policy: Policy, frame: string, history: Action[]): unknown {
  const window = policy.memoryWindow > 0 ? history.slice(-policy.memoryWindow) : [];
  const prompt = policy.promptTemplate.replace("{{history}}", window.join(", ")).replace("{{frame}}", "[image]");
  return {
    model: policy.model,
    messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: frame } }] }],
  };
}
