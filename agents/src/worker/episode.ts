// The Decision loop: frame -> Policy request -> 0G -> parsed Action -> sim.
import {
  buildDecideRequest, buildPerceiveRequest, buildRequest, isTwoStage, parseAction, parseDecideAction,
  type Action, type Decision, type Hex, type MissionLimits, type Policy, type Task, type TwoStagePolicy,
} from "../formats";
import type { InferencePort, InferenceReply, SimSession } from "./ports";

/** MAX_STEPS: maxSteps Decisions made without the goal. MAX_COLLISIONS: more collisions than a Pass allows, so stop paying 0G. */
export type EndReason = "GOAL" | "STOP" | "MAX_STEPS" | "MAX_COLLISIONS" | "SAFE_STOP";

export interface EpisodeResult {
  decisions: Decision[];
  endReason: EndReason;
}

export interface EpisodeInput {
  policy: Policy;
  session: SimSession;
  inference: InferencePort;
  /** The robot the Mission is for (taskOf its Course Seed): which Actions an answer can parse to. Default "rover". */
  task?: Task;
  /** The Mission's limits from the escrow: the loop bound and the point past which the Episode cannot pass. */
  limits: MissionLimits;
  /**
   * Unix seconds after which no new Decision starts: the Episode Submission deadline less the time the upload and
   * submitEpisode need. Reaching it safe-stops, so the honest partial log is still submitted on time.
   */
  stopAt?: number;
  /** Unix seconds; required with stopAt. */
  now?: () => number;
  /** Called after each Decision, with where its frame file lives (relative to runs/). */
  onDecision?: (decision: Decision, framePath: string) => void;
}

export async function runEpisode(input: EpisodeInput): Promise<EpisodeResult> {
  const decisions: Decision[] = [];
  const end = (endReason: EndReason): EpisodeResult => ({ decisions, endReason });
  let collisions = 0;

  while (decisions.length < input.limits.maxSteps) {
    if (pastStop(input)) return end("SAFE_STOP");
    const decided = await decide(input, decisions.length, decisions.map((d) => d.action));
    // 0G unreachable: the rover halts. Never fake a Decision.
    if (!decided) return end("SAFE_STOP");
    const { decision, framePath } = decided;
    decisions.push(decision);
    input.onDecision?.(decision, framePath);

    const result = await input.session.act(decision.action);
    if (decision.action === "STOP") return end("STOP");
    if (result.atGoal) return end("GOAL");
    // A collision blocks the move but the Episode goes on, until there are more than a Pass allows.
    if (result.collision && ++collisions > input.limits.maxCollisions) return end("MAX_COLLISIONS");
  }
  return end("MAX_STEPS");
}

const pastStop = ({ stopAt, now }: EpisodeInput): boolean => stopAt !== undefined && now !== undefined && now() >= stopAt;

/** One Decision (with its frame path), or null if 0G could not be reached. */
async function decide(input: EpisodeInput, step: number, history: Action[]): Promise<{ decision: Decision; framePath: string } | null> {
  const { policy, session } = input;
  const observation = await session.observe();
  const decision = isTwoStage(policy)
    ? await decideTwoStage(input, policy, step, history, observation.frame, observation.frameHash)
    : await decideSingleStage(input, policy, step, history, observation.frame, observation.frameHash);
  return decision ? { decision, framePath: observation.framePath } : null;
}

async function decideSingleStage(
  input: EpisodeInput, policy: Exclude<Policy, TwoStagePolicy>, step: number, history: Action[], frame: Uint8Array, frameHash: Hex,
): Promise<Decision | null> {
  const request = buildRequest(policy, frame, history);
  let reply: InferenceReply;
  try {
    reply = await input.inference.complete(policy.providerAddress, request);
  } catch (error) {
    // The Episode safe-stops on this; say why, or a cut-short Episode looks like the Policy chose to end it.
    console.error(`worker: 0G call for Decision ${step} failed, safe-stopping the Episode:`, error);
    return null;
  }
  return {
    step,
    frameHash,
    chatID: reply.chatID,
    providerAddress: policy.providerAddress,
    request,
    rawResponse: reply.rawResponse,
    action: parseAction(reply.rawResponse, input.task),
    ...(reply.receipt ? { receipt: reply.receipt } : {}),
  };
}

/** Each 0G call of a two-stage Decision is tried this many times before the Episode safe-stops (one retry). */
const ATTEMPTS_PER_CALL = 2;

/** Perceive (frame to Scene Description) then decide (scene and history to Action), both verifiable 0G calls (ADR 0008). */
async function decideTwoStage(
  input: EpisodeInput, policy: TwoStagePolicy, step: number, history: Action[], frame: Uint8Array, frameHash: Hex,
): Promise<Decision | null> {
  const perceiveRequest = buildPerceiveRequest(policy.perceive, frame);
  const perceived = await completeWithRetry(input.inference, policy.perceive.providerAddress, perceiveRequest, step, "perceive");
  if (!perceived) return null;

  const decideRequest = buildDecideRequest(policy.decide, perceived.rawResponse, history);
  const decided = await completeWithRetry(input.inference, policy.decide.providerAddress, decideRequest, step, "decide");
  if (!decided) return null;

  return {
    step,
    frameHash,
    chatID: decided.chatID,
    providerAddress: policy.decide.providerAddress,
    request: decideRequest,
    rawResponse: decided.rawResponse,
    action: parseDecideAction(decided.rawResponse, input.task),
    ...(decided.receipt ? { receipt: decided.receipt } : {}),
    perception: {
      chatID: perceived.chatID,
      providerAddress: policy.perceive.providerAddress,
      request: perceiveRequest,
      rawResponse: perceived.rawResponse,
      ...(perceived.receipt ? { receipt: perceived.receipt } : {}),
    },
  };
}

/** One 0G call, retried once on error. Every failed attempt is logged; null means the Episode must safe-stop. */
async function completeWithRetry(
  inference: InferencePort, provider: Hex, request: unknown, step: number, stage: "perceive" | "decide",
): Promise<InferenceReply | null> {
  for (let attempt = 1; attempt <= ATTEMPTS_PER_CALL; attempt++) {
    try {
      return await inference.complete(provider, request);
    } catch (error) {
      const outcome = attempt < ATTEMPTS_PER_CALL ? "retrying" : "safe-stopping the Episode";
      console.error(`worker: 0G ${stage} call for Decision ${step} failed (attempt ${attempt} of ${ATTEMPTS_PER_CALL}), ${outcome}:`, error);
    }
  }
  return null;
}
