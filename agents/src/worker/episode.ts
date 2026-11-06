// The Decision loop: frame -> Policy request -> 0G -> parsed Action -> sim.
import { buildRequest, DECISION_CAP, parseAction, type Action, type Decision, type Policy } from "../formats";
import type { InferencePort, InferenceReply, SimSession } from "./ports";

export type EndReason = "GOAL" | "COLLISION" | "STOP" | "DECISION_CAP" | "SAFE_STOP";

export interface EpisodeResult {
  decisions: Decision[];
  endReason: EndReason;
}

export interface EpisodeInput {
  policy: Policy;
  session: SimSession;
  inference: InferencePort;
  onDecision?: (decision: Decision) => void;
}

export async function runEpisode(input: EpisodeInput): Promise<EpisodeResult> {
  const decisions: Decision[] = [];
  const end = (endReason: EndReason): EpisodeResult => ({ decisions, endReason });

  while (decisions.length < DECISION_CAP) {
    const decision = await decide(input, decisions.length, decisions.map((d) => d.action));
    // 0G unreachable: the rover halts. Never fake a Decision.
    if (!decision) return end("SAFE_STOP");
    decisions.push(decision);
    input.onDecision?.(decision);

    const result = await input.session.act(decision.action);
    if (decision.action === "STOP") return end("STOP");
    if (result.collision) return end("COLLISION");
    if (result.atGoal) return end("GOAL");
  }
  return end("DECISION_CAP");
}

/** One Decision, or null if 0G could not be reached. */
async function decide(input: EpisodeInput, step: number, history: Action[]): Promise<Decision | null> {
  const { policy, session, inference } = input;
  const observation = await session.observe();
  const request = buildRequest(policy, observation.frame, history);

  let reply: InferenceReply;
  try {
    reply = await inference.complete(policy.providerAddress, request);
  } catch {
    return null;
  }

  return {
    step,
    frameHash: observation.frameHash,
    chatID: reply.chatID,
    providerAddress: policy.providerAddress,
    request,
    rawResponse: reply.rawResponse,
    action: parseAction(reply.rawResponse),
    ...(reply.receipt ? { receipt: reply.receipt } : {}),
  };
}
