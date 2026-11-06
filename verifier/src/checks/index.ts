import { keccak256, toBytes, type Hex } from "viem";
import { DECISION_CAP, canonicalJson, pathCost, pathQuality, type EpisodeLog, type Policy } from "@dewo/agents/formats";
import { SimInputError } from "../adapters/sim-cli.js";
import type { Fetched, MissionRecord, SealedBid, SimPort, ZeroGPort } from "../ports.js";
import { Outcome } from "../sign.js";
import { checkEpisodeLog, checkPolicy } from "./content.js";
import { checkDecisions } from "./decisions.js";
import { policyMatchesBid } from "./policy.js";
import { replayPasses } from "./replay.js";
import { seedMatchesCommitment } from "./seed.js";
import { optimalPathCostOf } from "./solvability.js";

export interface EpisodeInput {
  mission: MissionRecord;
  bid: SealedBid;
  reveal: { seed: Hex; salt: Hex };
  /** The Worker uploaded both documents, so neither is trusted to have the shape its type names until the checks validate it. */
  policy: Fetched<Policy>;
  log: Fetched<EpisodeLog>;
  episodeLogRoot: Hex;
  /** decisionCount recorded by EpisodeRegistry.submitEpisode. */
  decisionCount: number;
}
export interface VerifyDeps { sim: SimPort; zeroG: ZeroGPort }
export type CheckName = "header" | "seed" | "solvability" | "policy" | "decisions" | "replay";
export interface VerdictResult {
  outcome: Outcome;
  evidenceHash: Hex;
  /** Moving Actions in the Episode (STOP is free). 0 when no Replay ran. */
  pathCost: number;
  /** The planner's shortest Path Cost. 0 when the Course was not planned. */
  optimalPathCost: number;
  /** optimalPathCost / pathCost, 0..1; 0 when no Replay ran. Feeds Reliability, never the payout. */
  pathQuality: number;
  collisions: number;
  failedCheck?: CheckName;
  /** Why a Worker document was invalid content (never uploaded, not JSON, or not in its format). Hashed into the evidence. */
  reason?: string;
}

/** What a Replay measured. Zeros when the pipeline stopped before measuring it. */
interface Measured { pathCost: number; optimalPathCost: number; collisions: number; atGoal: boolean }
const NOT_MEASURED: Measured = { pathCost: 0, optimalPathCost: 0, collisions: 0, atGoal: false };

/** `reason` is only set for invalid content; canonicalJson drops it otherwise, so every other evidence hash is unchanged. */
const evidence = (e: EpisodeInput, outcome: Outcome, m: Measured, reason?: string): Hex =>
  keccak256(toBytes(canonicalJson({
    missionId: e.mission.missionId, outcome, episodeLogRoot: e.episodeLogRoot, policyHash: e.bid.policyHash,
    seedCommitment: e.mission.seedCommitment, ...m, reason,
  })));

/** The log must be for this Mission, this Bid's Worker and Seed Commitment, and as long as the on-chain submission says. */
const headerBindsEpisode = (e: EpisodeInput, log: EpisodeLog): boolean => {
  const h = log.header;
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  return same(h.missionId, e.mission.missionId) && same(h.worker, e.bid.worker) &&
    same(h.seedCommitment, e.mission.seedCommitment) && log.decisions.length === e.decisionCount;
};

/**
 * Run the spec 5.1 checks in order. Any failure is a Fail, except an unsolvable Course (Invalid Course). A Worker document that is
 * not valid content fails the first check that reads it (the log at "header", the Policy at "policy"), with the reason in the evidence.
 */
export async function verifyEpisode(deps: VerifyDeps, e: EpisodeInput): Promise<VerdictResult> {
  const done = (outcome: Outcome, m: Measured = NOT_MEASURED, failedCheck?: CheckName, reason?: string): VerdictResult => ({
    outcome, evidenceHash: evidence(e, outcome, m, reason),
    pathCost: m.pathCost, optimalPathCost: m.optimalPathCost, pathQuality: m.pathCost > 0 ? pathQuality(m.optimalPathCost, m.pathCost) : 0,
    collisions: m.collisions, failedCheck, reason,
  });
  const fail = (check: CheckName, reason?: string) => done(Outcome.Fail, NOT_MEASURED, check, reason);

  const log = checkEpisodeLog(e.log);
  if (!log.ok) return fail("header", log.reason);
  if (!headerBindsEpisode(e, log.value)) return fail("header");
  if (!seedMatchesCommitment(e.reveal.seed, e.reveal.salt, e.mission.seedCommitment)) return fail("seed");

  const course = await deps.sim.course(e.reveal.seed, e.mission.difficultyClass);
  const optimal = await optimalPathCostOf(deps.sim, course);
  if (optimal === null) return done(Outcome.InvalidCourse);

  const policy = checkPolicy(e.policy);
  if (!policy.ok) return fail("policy", policy.reason);
  if (!policyMatchesBid(policy.value, e.bid.policyHash)) return fail("policy");

  // Check 5: at most DECISION_CAP Decisions, judged on the log itself (the sim stops executing once the goal is reached).
  const { decisions } = log.value;
  if (decisions.length > DECISION_CAP) return fail("replay");

  const actions = decisions.map((d) => d.action);
  const replay = await deps.sim.replay(course, actions).catch((error: unknown) => {
    if (error instanceof SimInputError) return null; // the sim rejected the Action list itself
    throw error;
  });
  if (!replay) return fail("replay");
  const measured: Measured = { pathCost: pathCost(actions), optimalPathCost: optimal, collisions: replay.collisions, atGoal: replay.atGoal };
  if (!(await checkDecisions(deps.zeroG, policy.value, decisions, replay))) return done(Outcome.Fail, measured, "decisions");
  if (!replayPasses(replay, measured.pathCost, optimal)) return done(Outcome.Fail, measured, "replay");
  return done(Outcome.Pass, measured);
}
