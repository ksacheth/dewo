// The Decision loop: frame -> Policy request -> 0G -> parsed Action -> sim.
import { buildRequest, parseAction, type Action, type Decision, type MissionLimits, type Policy, type Task } from "../formats";
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
  const { policy, session, inference } = input;
  const observation = await session.observe();
  const request = buildRequest(policy, observation.frame, history);

  let reply: InferenceReply;
  try {
    reply = await inference.complete(policy.providerAddress, request);
  } catch {
    return null;
  }

  const decision: Decision = {
    step,
    frameHash: observation.frameHash,
    chatID: reply.chatID,
    providerAddress: policy.providerAddress,
    request,
    rawResponse: reply.rawResponse,
    action: parseAction(reply.rawResponse, input.task),
    ...(reply.receipt ? { receipt: reply.receipt } : {}),
  };
  return { decision, framePath: observation.framePath };
}
