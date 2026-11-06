import { keccak256, toBytes, type Hex } from "viem";
import { canonicalJson, movingSteps, replayableSteps, taskOf, type EpisodeLog, type MissionLimits, type Policy } from "@dewo/agents/formats";
import { SimInputError } from "../adapters/sim-cli.js";
import type { Fetched, MissionRecord, SealedBid, SimPort, ZeroGPort } from "../ports.js";
import { Outcome } from "../sign.js";
import { checkEpisodeLog, checkPolicy } from "./content.js";
import { checkDecisions } from "./decisions.js";
import { policyMatchesBid } from "./policy.js";
import { replayPasses } from "./replay.js";

export interface EpisodeInput {
  mission: MissionRecord;
  bid: SealedBid;
  /** The Worker uploaded both documents, so neither is trusted to have the shape its type names until the checks validate it. */
  policy: Fetched<Policy>;
  log: Fetched<EpisodeLog>;
  episodeLogRoot: Hex;
  /** decisionCount recorded by EpisodeRegistry.submitEpisode. */
  decisionCount: number;
}
export interface VerifyDeps { sim: SimPort; zeroG: ZeroGPort }
export type CheckName = "header" | "policy" | "steps" | "decisions" | "replay";
export interface VerdictResult {
  outcome: Outcome;
  evidenceHash: Hex;
  /** Moving Actions in the Episode (STOP is free). 0 when no Replay ran. */
  steps: number;
  collisions: number;
  failedCheck?: CheckName;
  /** Why a Worker document was invalid content (never uploaded, not JSON, or not in its format). Hashed into the evidence. */
  reason?: string;
}

/** What a Replay measured. Zeros when the pipeline stopped before measuring it. */
interface Measured { steps: number; collisions: number; atGoal: boolean }
const NOT_MEASURED: Measured = { steps: 0, collisions: 0, atGoal: false };

const limitsOf = (m: MissionRecord): MissionLimits => ({ maxSteps: m.maxSteps, maxCollisions: m.maxCollisions });

/** `reason` is only set for invalid content; canonicalJson drops it otherwise. The on-chain terms judged against are part of the evidence. */
const evidence = (e: EpisodeInput, outcome: Outcome, m: Measured, reason?: string): Hex =>
  keccak256(toBytes(canonicalJson({
    missionId: e.mission.missionId, outcome, episodeLogRoot: e.episodeLogRoot, policyHash: e.bid.policyHash,
    courseSeed: e.mission.courseSeed, ...limitsOf(e.mission), ...m, reason,
  })));

/** The log must be for this Mission, this Bid's Worker and Course Seed, and as long as the on-chain submission says. */
const headerBindsEpisode = (e: EpisodeInput, log: EpisodeLog): boolean => {
  const h = log.header;
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  return same(h.missionId, e.mission.missionId) && same(h.worker, e.bid.worker) &&
    same(h.courseSeed, e.mission.courseSeed) && log.decisions.length === e.decisionCount;
};

/**
 * Run the spec 5.1 checks in order; any failure is a Fail. A Worker document that is not valid content fails the first check that
 * reads it (the log at "header", the Policy at "policy"), with the reason in the evidence.
 */
export async function verifyEpisode(deps: VerifyDeps, e: EpisodeInput): Promise<VerdictResult> {
  const done = (outcome: Outcome, m: Measured = NOT_MEASURED, failedCheck?: CheckName, reason?: string): VerdictResult => ({
    outcome, evidenceHash: evidence(e, outcome, m, reason), steps: m.steps, collisions: m.collisions, failedCheck, reason,
  });
  const fail = (check: CheckName, reason?: string) => done(Outcome.Fail, NOT_MEASURED, check, reason);

  const log = checkEpisodeLog(e.log);
  if (!log.ok) return fail("header", log.reason);
  if (!headerBindsEpisode(e, log.value)) return fail("header");

  // Check 1: the revealed Policy is the one the Bid committed to.
  const policy = checkPolicy(e.policy);
  if (!policy.ok) return fail("policy", policy.reason);
  if (!policyMatchesBid(policy.value, e.bid.policyHash)) return fail("policy");

  // Check 2 starts with the Mission's maxSteps (never above the protocol's MAX_STEPS), judged on the log itself before the sim
  // runs: it bounds what any log can make this Verifier replay, whatever maxSteps the escrow holds.
  const { decisions } = log.value;
  if (decisions.length > replayableSteps(limitsOf(e.mission))) return fail("steps");

  const course = await deps.sim.course(e.mission.courseSeed, e.mission.difficultyClass);
  const actions = decisions.map((d) => d.action);
  const replay = await deps.sim.replay(course, actions).catch((error: unknown) => {
    if (error instanceof SimInputError) return null; // the sim rejected the Action list itself
    throw error;
  });
  if (!replay) return fail("replay");
  const measured: Measured = { steps: movingSteps(actions), collisions: replay.collisions, atGoal: replay.atGoal };
  // The task is read from the on-chain Course Seed, as the Worker and the sim read it.
  if (!(await checkDecisions(deps.zeroG, policy.value, decisions, replay, taskOf(e.mission.courseSeed)))) return done(Outcome.Fail, measured, "decisions");
  // Check 3: the goal within the Requester's limits.
  if (!replayPasses(replay, decisions.length, limitsOf(e.mission))) return done(Outcome.Fail, measured, "replay");
  return done(Outcome.Pass, measured);
}
