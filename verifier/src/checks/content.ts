import { ACTIONS, policyProblems, type EpisodeLog, type Policy } from "@dewo/agents/formats";
import { NotJson } from "../ports.js";

/**
 * A Worker-uploaded document after validation: the typed value, or why it is invalid content. The reasons are fixed strings,
 * never parser messages, so every Verifier hashes the same evidence for the same bytes whatever its Node version.
 */
export type Checked<T> = { ok: true; value: T } | { ok: false; reason: string };

type Fields = Record<string, unknown>;
const isObject = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);
const allStrings = (o: Fields, keys: readonly string[]) => keys.every((k) => typeof o[k] === "string");

const HEADER_STRINGS = ["missionId", "worker", "policyRoot", "seedCommitment"] as const;
const DECISION_STRINGS = ["frameHash", "chatID", "providerAddress", "rawResponse"] as const;
const POLICY_STRINGS = ["name", "model", "providerAddress", "promptTemplate", "version"] as const;

const isDecision = (d: unknown): boolean =>
  isObject(d) && Number.isInteger(d.step) && allStrings(d, DECISION_STRINGS) && (ACTIONS as readonly unknown[]).includes(d.action);

/** The I3 shape, every field the checks read. The Worker wrote the log, so nothing about it is trusted. */
const isEpisodeLog = (log: unknown): log is EpisodeLog =>
  isObject(log) && isObject(log.header) && allStrings(log.header, HEADER_STRINGS) &&
  Array.isArray(log.decisions) && log.decisions.every(isDecision);

/** The I2 shape, then the same usability rules a Worker asserts at startup, so an honest Policy always passes. */
const isPolicy = (p: unknown): p is Policy =>
  isObject(p) && allStrings(p, POLICY_STRINGS) && Number.isInteger(p.memoryWindow) && (p.memoryWindow as number) >= 0 &&
  typeof p.temperature === "number" && policyProblems(p as unknown as Policy).length === 0;

function checked<T>(doc: unknown, isValid: (v: unknown) => v is T, name: string, format: string): Checked<T> {
  if (doc instanceof NotJson) return { ok: false, reason: `${name} is not valid JSON` };
  return isValid(doc) ? { ok: true, value: doc } : { ok: false, reason: `${name} does not match the ${format} format` };
}

export const checkEpisodeLog = (doc: EpisodeLog | NotJson): Checked<EpisodeLog> => checked(doc, isEpisodeLog, "episode log", "Episode Log");
export const checkPolicy = (doc: Policy | NotJson): Checked<Policy> => checked(doc, isPolicy, "policy", "Policy");
