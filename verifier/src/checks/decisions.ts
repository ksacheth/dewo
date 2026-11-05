import { buildRequest, canonicalJson, parseAction, type Decision, type Policy } from "../formats.js";
import type { ReplayResult, ZeroGPort } from "../ports.js";

export interface DecisionsResult { ok: boolean; gaps: string[] }

/**
 * Check 4, per Decision: the Replay frame hash equals frameHash; 0G vouches for the chat ID;
 * the request rebuilt from Policy + Replay frame + history equals the logged request (anti-steering, spike #2);
 * and parse(rawResponse) == action. Without Replay frame payloads the rebuild is skipped and reported as a gap.
 */
export async function checkDecisions(
  zeroG: ZeroGPort, policy: Policy, decisions: Decision[], replay: ReplayResult,
): Promise<DecisionsResult> {
  const gaps: string[] = [];
  const history = [] as Decision["action"][];
  for (const [i, d] of decisions.entries()) {
    if (d.step !== i) return { ok: false, gaps };
    if (replay.frameHashes[i]?.toLowerCase() !== d.frameHash.toLowerCase()) return { ok: false, gaps };
    if (!(await zeroG.verifyResponse(d.providerAddress, d.chatID))) return { ok: false, gaps };

    const frame = replay.frames?.[i];
    if (frame === undefined) {
      if (!gaps.includes("request-rebuild-skipped")) gaps.push("request-rebuild-skipped");
    } else if (canonicalJson(d.request) !== canonicalJson(buildRequest(policy, frame, history))) {
      return { ok: false, gaps };
    }

    if (parseAction(d.rawResponse) !== d.action) return { ok: false, gaps };
    history.push(d.action);
  }
  return { ok: true, gaps };
}
