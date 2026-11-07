import { ACTIONS, isTwoStage, policyProblems, type EpisodeLog, type Policy } from "@dewo/agents/formats";
import { NotJson, NotUploaded, type Fetched } from "../ports.js";

/**
 * A Worker-uploaded document after validation: the typed value, or why it is invalid content. The reasons are fixed strings,
 * never parser messages, so every Verifier hashes the same evidence for the same bytes whatever its Node version.
 */
export type Checked<T> = { ok: true; value: T } | { ok: false; reason: string };

type Fields = Record<string, unknown>;
const isObject = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);
const allStrings = (o: Fields, keys: readonly string[]) => keys.every((k) => typeof o[k] === "string");

const HEADER_STRINGS = ["missionId", "worker", "policyRoot", "courseSeed"] as const;
const DECISION_STRINGS = ["frameHash", "chatID", "providerAddress", "rawResponse"] as const;
const PERCEPTION_STRINGS = ["chatID", "providerAddress", "rawResponse"] as const;
const STAGE_STRINGS = ["model", "providerAddress", "promptTemplate"] as const;
const POLICY_STRINGS = ["name", "model", "providerAddress", "promptTemplate", "version"] as const;

/** The perceive call of a two-stage Decision (ADR 0008): absent for single-stage Policies, a full call record otherwise. */
const isPerception = (p: unknown): boolean => isObject(p) && allStrings(p, PERCEPTION_STRINGS);

const isDecision = (d: unknown): boolean =>
  isObject(d) && Number.isInteger(d.step) && allStrings(d, DECISION_STRINGS) && (ACTIONS as readonly unknown[]).includes(d.action) &&
  (d.perception === undefined || isPerception(d.perception));

/** The I3 shape, every field the checks read. The Worker wrote the log, so nothing about it is trusted. */
const isEpisodeLog = (log: unknown): log is EpisodeLog =>
  isObject(log) && isObject(log.header) && allStrings(log.header, HEADER_STRINGS) &&
  Array.isArray(log.decisions) && log.decisions.every(isDecision);

/** The I2 shape, then the same usability rules a Worker asserts at startup, so an honest Policy always passes. */
const isPolicy = (p: unknown): p is Policy =>
  isObject(p) && typeof p.name === "string" && typeof p.version === "string" &&
  (p.perceive !== undefined || p.decide !== undefined ? isTwoStagePolicy(p) : isSingleStagePolicy(p));

const isSingleStagePolicy = (p: Fields): boolean =>
  allStrings(p, POLICY_STRINGS) && Number.isInteger(p.memoryWindow) && (p.memoryWindow as number) >= 0 &&
  typeof p.temperature === "number" && policyProblems(p as unknown as Policy).length === 0;

/** Both stages are objects with string settings; policyProblems then applies the rules a Worker asserts at startup. */
const isTwoStagePolicy = (p: Fields): boolean =>
  isObject(p.perceive) && isObject(p.decide) &&
  allStrings(p.perceive, STAGE_STRINGS) && allStrings(p.decide, STAGE_STRINGS) && isTwoStage(p as unknown as Policy) &&
  policyProblems(p as unknown as Policy).length === 0;

function checked<T>(doc: unknown, isValid: (v: unknown) => v is T, name: string, format: string): Checked<T> {
  if (doc instanceof NotUploaded) return { ok: false, reason: `${name} was never uploaded to 0G Storage` };
  if (doc instanceof NotJson) return { ok: false, reason: `${name} is not valid JSON` };
  return isValid(doc) ? { ok: true, value: doc } : { ok: false, reason: `${name} does not match the ${format} format` };
}

export const checkEpisodeLog = (doc: Fetched<EpisodeLog>): Checked<EpisodeLog> => checked(doc, isEpisodeLog, "episode log", "Episode Log");
export const checkPolicy = (doc: Fetched<Policy>): Checked<Policy> => checked(doc, isPolicy, "policy", "Policy");
