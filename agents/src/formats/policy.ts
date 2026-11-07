import { keccak256, toBytes } from "viem";
import type { Hex } from "./episode-log";
import { TASKS, type Task } from "./task";
import { FRAME_PLACEHOLDER, HISTORY_PLACEHOLDER, RESERVED_REQUEST_FIELDS, SCENE_PLACEHOLDER } from "./request";

// I2: a Worker's fixed recipe for piloting, committed by hash in its Bid.

/** Fields every Policy has, whichever form it takes. */
interface PolicyBase {
  name: string;
  /** The robot this Policy pilots; absent means "rover" (Policies from before the drone). A Worker bids only on Missions of its task. */
  task?: Task;
  version: string;
}

/** The fields of one 0G chat call a Policy commits to. */
interface StageBase {
  /** 0G model id. */
  model: string;
  providerAddress: Hex;
  /** 0 for every demo Policy, to keep answers as repeatable as 0G allows. */
  temperature: number;
  /**
   * Extra top-level fields merged into every request body, e.g. `{ "chat_template_kwargs": { "enable_thinking": false } }`
   * (ADR 0004). Part of the committed Policy, so a Verifier's request rebuild includes them. They can never replace
   * the fields the request builders set themselves (RESERVED_REQUEST_FIELDS). Routing headers are not part of the body.
   */
  requestOptions?: Readonly<Record<string, unknown>>;
}

/** Stage 1 of a two-stage Policy: a vision model turns the camera frame into a text Scene Description (ADR 0008). */
export interface PerceiveStage extends StageBase {
  /** Must contain the {{frame}} placeholder. */
  promptTemplate: string;
}

/** Stage 2 of a two-stage Policy: a text model reads the Scene Description and history and picks the Action (ADR 0008). */
export interface DecideStage extends StageBase {
  /** Must contain the {{scene}} and {{history}} placeholders and ask for a final `ACTION: <WORD>` line. */
  promptTemplate: string;
  /** How many past Decisions are fed back into {{history}}. */
  memoryWindow: number;
}

/** The original form: one vision model sees the frame and answers with the Action. */
export interface SingleStagePolicy extends PolicyBase, StageBase {
  /** Must contain the {{frame}} and {{history}} placeholders. */
  promptTemplate: string;
  /** How many past Decisions are fed back into {{history}}. */
  memoryWindow: number;
  perceive?: undefined;
  decide?: undefined;
}

/** The perceive-then-decide form (ADR 0008): it has no top-level model fields, each stage carries its own. */
export interface TwoStagePolicy extends PolicyBase {
  perceive: PerceiveStage;
  decide: DecideStage;
  model?: undefined;
  providerAddress?: undefined;
  promptTemplate?: undefined;
  memoryWindow?: undefined;
  temperature?: undefined;
  requestOptions?: undefined;
}

export type Policy = SingleStagePolicy | TwoStagePolicy;

export function isTwoStage(policy: Policy): policy is TwoStagePolicy {
  return policy.perceive !== undefined || policy.decide !== undefined;
}

/** Verifiable 0G calls one Decision costs: 1, or 2 for a two-stage Policy (perceive, then decide). Per-call costs scale by it. */
export function callsPerDecision(policy: Policy): number {
  return isTwoStage(policy) ? 2 : 1;
}

/** The task a Policy pilots: its `task`, or "rover" when it predates the field. */
export function policyTask(policy: Policy): Task {
  return policy.task ?? "rover";
}

/** Everything wrong with a Policy that would make a Worker unable to fly with it, as readable sentences. */
export function policyProblems(policy: Policy): string[] {
  const at = `Policy "${policy.name}"`;
  const problems: string[] = [];
  if (policy.task !== undefined && !(TASKS as readonly unknown[]).includes(policy.task)) {
    problems.push(`${at}: task must be one of ${TASKS.join(", ")}, not ${JSON.stringify(policy.task)}`);
  }
  problems.push(...(isTwoStage(policy) ? twoStageProblems(policy, at) : stageProblems(policy, at, [FRAME_PLACEHOLDER, HISTORY_PLACEHOLDER])));
  return problems;
}

function twoStageProblems(policy: TwoStagePolicy, at: string): string[] {
  const problems: string[] = [];
  if (!isPlainObject(policy.perceive) || !isPlainObject(policy.decide)) {
    return [`${at}: a two-stage Policy needs both a perceive and a decide object`];
  }
  const stray = ["model", "providerAddress", "promptTemplate", "memoryWindow", "temperature", "requestOptions"].filter(
    (key) => (policy as unknown as Record<string, unknown>)[key] !== undefined,
  );
  if (stray.length > 0) problems.push(`${at}: a two-stage Policy keeps its settings in perceive and decide, not at the top level (${stray.join(", ")})`);
  problems.push(...stageProblems(policy.perceive, `${at} perceive`, [FRAME_PLACEHOLDER]));
  problems.push(...stageProblems(policy.decide, `${at} decide`, [SCENE_PLACEHOLDER, HISTORY_PLACEHOLDER]));
  if (typeof policy.decide.promptTemplate === "string" && !/ACTION:/i.test(policy.decide.promptTemplate)) {
    problems.push(`${at} decide: promptTemplate must ask for a final "ACTION: <WORD>" line`);
  }
  if (!Number.isInteger(policy.decide.memoryWindow) || policy.decide.memoryWindow < 0) {
    problems.push(`${at} decide: memoryWindow must be a whole number of at least 0`);
  }
  return problems;
}

/** What is wrong with one chat call's settings: its prompt placeholders, provider, model, temperature and requestOptions. */
function stageProblems(stage: StageBase & { promptTemplate: string }, at: string, placeholders: readonly string[]): string[] {
  const problems: string[] = [];
  for (const placeholder of placeholders) {
    if (typeof stage.promptTemplate !== "string" || !stage.promptTemplate.includes(placeholder)) {
      problems.push(`${at}: promptTemplate has no ${placeholder} placeholder`);
    }
  }
  if (typeof stage.providerAddress !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(stage.providerAddress) || /^0x0{40}$/.test(stage.providerAddress)) {
    problems.push(`${at}: providerAddress must be a real 0G provider address, not ${stage.providerAddress} (ADR 0004 pins 0xf4FB8d2bD856e672b5f9848b0eD235A20079B250)`);
  }
  if (typeof stage.model !== "string" || stage.model.trim() === "" || /^tbd\b/i.test(stage.model.trim())) {
    problems.push(`${at}: model is a placeholder (${JSON.stringify(stage.model)}); set a model id the provider serves (ADR 0004: 0gm-1.0-35b-a3b)`);
  }
  if (typeof stage.temperature !== "number") problems.push(`${at}: temperature must be a number`);
  problems.push(...requestOptionsProblems(stage, at));
  return problems;
}

function requestOptionsProblems(stage: StageBase, at: string): string[] {
  const options = stage.requestOptions;
  if (options === undefined) return [];
  if (!isPlainObject(options)) return [`${at}: requestOptions must be a JSON object`];
  const reserved = Object.keys(options).filter((key) => (RESERVED_REQUEST_FIELDS as readonly string[]).includes(key));
  return reserved.map((key) => `${at}: requestOptions cannot set "${key}" (the request builders set it from the Policy)`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
