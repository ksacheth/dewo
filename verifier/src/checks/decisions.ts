import {
  buildDecideRequest, buildPerceiveRequest, buildRequest, canonicalJson, isTwoStage, parseAction, parseDecideAction,
  type Action, type Decision, type Policy, type Task, type TwoStagePolicy,
} from "@dewo/agents/formats";
import type { ReplayResult, ZeroGPort } from "../ports.js";
import { frameHashOfPng } from "./frame.js";

const PNG_DATA_URL = "data:image/png;base64,";

/** The PNG the Worker attached to its 0G request, or null if the request is not shaped like a Policy request. */
function attachedPng(request: unknown): Uint8Array | null {
  const url = (request as { messages?: Array<{ content?: Array<{ image_url?: { url?: unknown } }> }> } | null)
    ?.messages?.[0]?.content?.[1]?.image_url?.url;
  return typeof url === "string" && url.startsWith(PNG_DATA_URL) ? Buffer.from(url.slice(PNG_DATA_URL.length), "base64") : null;
}

const sameAddress = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * Check 2, per Decision:
 * - the PNG in the logged request has the Replay frame hash (the sim hashes raw pixels), so it is the frame the rover really saw;
 * - 0G vouches for the chat ID;
 * - the request rebuilt from Policy + that frame + history equals the logged request (anti-steering, spike #2);
 * - parse(rawResponse) == action, parsed with the Actions of the Mission's task (a rover answer of ASCEND is STOP).
 * A two-stage Policy (ADR 0008) has two calls per Decision, each checked the same way: the perceive call on the frame,
 * the decide call on the logged Scene Description and the history, and the action parsed from the decide answer.
 * Whether 0G's signed answer belongs to this exact request is still open (README, spike #2).
 */
export async function checkDecisions(
  zeroG: ZeroGPort, policy: Policy, decisions: Decision[], replay: ReplayResult, task: Task = "rover",
  /** Called after each Decision passes, with the count checked so far and the total. */
  onChecked?: (checked: number, total: number) => void | Promise<void>,
): Promise<boolean> {
  const history: Action[] = [];
  for (const [i, d] of decisions.entries()) {
    if (d.step !== i) return false;
    const replayHash = replay.frameHashes[i]?.toLowerCase();
    if (replayHash !== d.frameHash.toLowerCase()) return false;
    const ok = isTwoStage(policy)
      ? await checkTwoStageDecision(zeroG, policy, d, replayHash, history, task)
      : await checkSingleStageDecision(zeroG, policy, d, replayHash, history, task);
    if (!ok) return false;
    history.push(d.action);
    await onChecked?.(i + 1, decisions.length);
  }
  return true;
}

async function checkSingleStageDecision(
  zeroG: ZeroGPort, policy: Exclude<Policy, TwoStagePolicy>, d: Decision, replayHash: string, history: Action[], task: Task,
): Promise<boolean> {
  if (d.perception !== undefined) return false; // a single-stage Policy has no perceive call
  // The Policy commits to its provider, so a Decision answered by another one did not follow the Policy.
  if (!sameAddress(d.providerAddress, policy.providerAddress)) return false;
  if (!(await zeroG.verifyResponse(d.providerAddress, d.chatID))) return false;

  const png = attachedPng(d.request);
  if (!png || frameHashOfPng(png) !== replayHash) return false;
  if (canonicalJson(d.request) !== canonicalJson(buildRequest(policy, png, history))) return false;
  return parseAction(d.rawResponse, task) === d.action;
}

async function checkTwoStageDecision(
  zeroG: ZeroGPort, policy: TwoStagePolicy, d: Decision, replayHash: string, history: Action[], task: Task,
): Promise<boolean> {
  const seen = d.perception;
  if (seen === undefined) return false;
  // Perceive: the frame the rover saw, described by the committed vision model.
  if (!sameAddress(seen.providerAddress, policy.perceive.providerAddress)) return false;
  if (!(await zeroG.verifyResponse(seen.providerAddress, seen.chatID))) return false;
  const png = attachedPng(seen.request);
  if (!png || frameHashOfPng(png) !== replayHash) return false;
  if (canonicalJson(seen.request) !== canonicalJson(buildPerceiveRequest(policy.perceive, png))) return false;

  // Decide: the committed text model, asked about the logged Scene Description and the history.
  if (!sameAddress(d.providerAddress, policy.decide.providerAddress)) return false;
  if (!(await zeroG.verifyResponse(d.providerAddress, d.chatID))) return false;
  if (canonicalJson(d.request) !== canonicalJson(buildDecideRequest(policy.decide, seen.rawResponse, history))) return false;
  return parseDecideAction(d.rawResponse, task) === d.action;
}
