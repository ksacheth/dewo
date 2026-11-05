import { keccak256, toBytes, type Hex } from "viem";
import { canonicalJson, type EpisodeLog, type Policy } from "../formats.js";
import type { MissionRecord, SealedBid, SimPort, ZeroGPort } from "../ports.js";
import { Outcome } from "../sign.js";
import { checkDecisions } from "./decisions.js";
import { policyMatchesBid } from "./policy.js";
import { replayPasses } from "./replay.js";
import { seedMatchesCommitment } from "./seed.js";
import { isSolvable } from "./solvability.js";

export interface EpisodeInput {
  mission: MissionRecord;
  bid: SealedBid;
  reveal: { seed: Hex; salt: Hex };
  policy: Policy;
  log: EpisodeLog;
  episodeLogRoot: Hex;
}
export interface VerifyDeps { sim: SimPort; zeroG: ZeroGPort }
export type CheckName = "seed" | "solvability" | "policy" | "decisions" | "replay";
export interface VerdictResult {
  outcome: Outcome;
  evidenceHash: Hex;
  steps: number;
  collisions: number;
  failedCheck?: CheckName;
  /** Checks that could not run fully (e.g. request rebuild without frame payloads). */
  gaps: string[];
}

const evidence = (e: EpisodeInput, outcome: Outcome, steps: number, collisions: number, atGoal: boolean): Hex =>
  keccak256(toBytes(canonicalJson({
    missionId: e.mission.missionId, outcome, episodeLogRoot: e.episodeLogRoot, policyHash: e.bid.policyHash,
    seedCommitment: e.mission.seedCommitment, steps, collisions, atGoal,
  })));

/** Run the spec 5.1 checks in order. Any failure is a Fail, except an unsolvable Course (Invalid Course). */
export async function verifyEpisode(deps: VerifyDeps, e: EpisodeInput): Promise<VerdictResult> {
  const done = (outcome: Outcome, steps: number, collisions: number, atGoal: boolean, failedCheck?: CheckName, gaps: string[] = []): VerdictResult =>
    ({ outcome, evidenceHash: evidence(e, outcome, steps, collisions, atGoal), steps, collisions, failedCheck, gaps });
  const fail = (check: CheckName) => done(Outcome.Fail, 0, 0, false, check);

  if (!seedMatchesCommitment(e.reveal.seed, e.reveal.salt, e.mission.seedCommitment)) return fail("seed");

  const course = await deps.sim.course(e.reveal.seed, e.mission.difficultyClass);
  if (!(await isSolvable(deps.sim, course, e.mission.stepBudget))) return done(Outcome.InvalidCourse, 0, 0, false);

  if (!policyMatchesBid(e.policy, e.bid.policyHash)) return fail("policy");

  const replay = await deps.sim.replay(course, e.log.decisions.map((d) => d.action));
  const decisions = await checkDecisions(deps.zeroG, e.policy, e.log.decisions, replay);
  if (!decisions.ok) return done(Outcome.Fail, replay.steps, replay.collisions, replay.atGoal, "decisions", decisions.gaps);
  if (!replayPasses(replay, e.mission.stepBudget)) return done(Outcome.Fail, replay.steps, replay.collisions, replay.atGoal, "replay", decisions.gaps);
  return done(Outcome.Pass, replay.steps, replay.collisions, replay.atGoal, undefined, decisions.gaps);
}
