import { buildRequest, canonicalJson, parseAction, type Action, type Decision, type Policy, type Task } from "@dewo/agents/formats";
import type { ReplayResult, ZeroGPort } from "../ports.js";
import { frameHashOfPng } from "./frame.js";

const PNG_DATA_URL = "data:image/png;base64,";

/** The PNG the Worker attached to its 0G request, or null if the request is not shaped like a Policy request. */
function attachedPng(request: unknown): Uint8Array | null {
  const url = (request as { messages?: Array<{ content?: Array<{ image_url?: { url?: unknown } }> }> } | null)
    ?.messages?.[0]?.content?.[1]?.image_url?.url;
  return typeof url === "string" && url.startsWith(PNG_DATA_URL) ? Buffer.from(url.slice(PNG_DATA_URL.length), "base64") : null;
}

/**
 * Check 2, per Decision:
 * - the PNG in the logged request has the Replay frame hash (the sim hashes raw pixels), so it is the frame the rover really saw;
 * - 0G vouches for the chat ID;
 * - the request rebuilt from Policy + that frame + history equals the logged request (anti-steering, spike #2);
 * - parse(rawResponse) == action, parsed with the Actions of the Mission's task (a rover answer of ASCEND is STOP).
 * Whether 0G's signed answer belongs to this exact request is still open (README, spike #2).
 */
export async function checkDecisions(
  zeroG: ZeroGPort, policy: Policy, decisions: Decision[], replay: ReplayResult, task: Task = "rover",
): Promise<boolean> {
  const history: Action[] = [];
  for (const [i, d] of decisions.entries()) {
    if (d.step !== i) return false;
    const replayHash = replay.frameHashes[i]?.toLowerCase();
    if (replayHash !== d.frameHash.toLowerCase()) return false;
    // The Policy commits to its provider, so a Decision answered by another one did not follow the Policy.
    if (d.providerAddress.toLowerCase() !== policy.providerAddress.toLowerCase()) return false;
    if (!(await zeroG.verifyResponse(d.providerAddress, d.chatID))) return false;

    const png = attachedPng(d.request);
    if (!png || frameHashOfPng(png) !== replayHash) return false;
    if (canonicalJson(d.request) !== canonicalJson(buildRequest(policy, png, history))) return false;

    if (parseAction(d.rawResponse, task) !== d.action) return false;
    history.push(d.action);
  }
  return true;
}
