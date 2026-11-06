import { keccak256, toBytes, type Hex } from "viem";
import { DECISION_CAP, canonicalJson, pathCost, pathQuality, type EpisodeLog, type Policy } from "@dewo/agents/formats";
import type { MissionRecord, SealedBid, SimPort, ZeroGPort } from "../ports.js";
import { Outcome } from "../sign.js";
import { checkDecisions } from "./decisions.js";
import { policyMatchesBid } from "./policy.js";
import { replayPasses } from "./replay.js";
import { seedMatchesCommitment } from "./seed.js";
import { optimalPathCostOf } from "./solvability.js";

export interface EpisodeInput {
  mission: MissionRecord;
  bid: SealedBid;
  reveal: { seed: Hex; salt: Hex };
  policy: Policy;
  log: EpisodeLog;
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
  /** Checks that could not run fully (e.g. request rebuild without frame payloads). */
  gaps: string[];
}

/** What a Replay measured. Zeros when the pipeline stopped before measuring it. */
interface Measured { pathCost: number; optimalPathCost: number; collisions: number; atGoal: boolean }
const NOT_MEASURED: Measured = { pathCost: 0, optimalPathCost: 0, collisions: 0, atGoal: false };

const evidence = (e: EpisodeInput, outcome: Outcome, m: Measured): Hex =>
  keccak256(toBytes(canonicalJson({
    missionId: e.mission.missionId, outcome, episodeLogRoot: e.episodeLogRoot, policyHash: e.bid.policyHash,
    seedCommitment: e.mission.seedCommitment, ...m,
  })));

/** The log must be for this Mission, this Bid's Worker and Seed Commitment, and as long as the on-chain submission says. */
const headerBindsEpisode = (e: EpisodeInput): boolean => {
  const h = e.log.header;
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  return same(h.missionId, e.mission.missionId) && same(h.worker, e.bid.worker) &&
    same(h.seedCommitment, e.mission.seedCommitment) && e.log.decisions.length === e.decisionCount;
};

/** Run the spec 5.1 checks in order. Any failure is a Fail, except an unsolvable Course (Invalid Course). */
export async function verifyEpisode(deps: VerifyDeps, e: EpisodeInput): Promise<VerdictResult> {
  const done = (outcome: Outcome, m: Measured = NOT_MEASURED, failedCheck?: CheckName, gaps: string[] = []): VerdictResult => ({
    outcome, evidenceHash: evidence(e, outcome, m),
    pathCost: m.pathCost, optimalPathCost: m.optimalPathCost, pathQuality: m.pathCost > 0 ? pathQuality(m.optimalPathCost, m.pathCost) : 0,
    collisions: m.collisions, failedCheck, gaps,
  });
  const fail = (check: CheckName) => done(Outcome.Fail, NOT_MEASURED, check);

  if (!headerBindsEpisode(e)) return fail("header");
  if (!seedMatchesCommitment(e.reveal.seed, e.reveal.salt, e.mission.seedCommitment)) return fail("seed");

  const course = await deps.sim.course(e.reveal.seed, e.mission.difficultyClass);
  const optimal = await optimalPathCostOf(deps.sim, course);
  if (optimal === null) return done(Outcome.InvalidCourse);

  if (!policyMatchesBid(e.policy, e.bid.policyHash)) return fail("policy");

  // Check 5: at most DECISION_CAP Decisions, judged on the log itself (the sim stops executing once the goal is reached).
  if (e.log.decisions.length > DECISION_CAP) return fail("replay");

  const actions = e.log.decisions.map((d) => d.action);
  const replay = await deps.sim.replay(course, actions);
  const measured: Measured = { pathCost: pathCost(actions), optimalPathCost: optimal, collisions: replay.collisions, atGoal: replay.atGoal };
  const decisions = await checkDecisions(deps.zeroG, e.policy, e.log.decisions, replay);
  if (!decisions.ok) return done(Outcome.Fail, measured, "decisions", decisions.gaps);
  if (!replayPasses(replay, measured.pathCost, optimal)) return done(Outcome.Fail, measured, "replay", decisions.gaps);
  return done(Outcome.Pass, measured, undefined, decisions.gaps);
}
