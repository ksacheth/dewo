import { keccak256, toBytes, type Address, type Hex } from "viem";
import { canonicalJson } from "../formats.js";
import { verifyEpisode } from "../checks/index.js";
import { classifyTimeline } from "../deadlines.js";
import type { EpisodeSource, EventSink, SimPort, VerdictSink, ZeroGPort } from "../ports.js";
import { Outcome, signVerdict } from "../sign.js";

export interface ReplayDeps {
  source: EpisodeSource; sim: SimPort; zeroG: ZeroGPort;
  verdicts: VerdictSink; events: EventSink;
  key: Hex; escrow: Address; now: () => number; // unix seconds
}
export interface ReplayResponse { verdict: Outcome; signature: Hex; evidenceHash: Hex }

export class PendingError extends Error {}

/** Decide the Outcome (by deadlines or by Replay), sign the Verdict, record it on Arkiv, and return it. */
export async function handleReplay(deps: ReplayDeps, missionId: Hex): Promise<ReplayResponse> {
  const loaded = await deps.source.load(missionId);
  const byDeadline = classifyTimeline({ ...loaded.timeline, now: deps.now() });

  let outcome: Outcome;
  let evidenceHash: Hex;
  let steps = 0;
  let collisions = 0;
  const episodeLogRoot = loaded.episode?.episodeLogRoot ?? null;

  if (byDeadline !== null) {
    outcome = byDeadline;
    evidenceHash = keccak256(toBytes(canonicalJson({ missionId, outcome })));
  } else if (loaded.episode) {
    const result = await verifyEpisode(deps, { mission: loaded.mission, ...loaded.episode });
    ({ outcome, evidenceHash, steps, collisions } = result);
  } else {
    throw new PendingError(`mission ${missionId} is pending: no Verdict can be signed yet`);
  }

  const signature = await signVerdict(deps.key, deps.escrow, { missionId, outcome, evidenceHash });
  await deps.verdicts.writeVerdict({ missionId, worker: loaded.worker, outcome, steps, collisions, signature, evidenceHash, episodeLogRoot });
  await deps.events.emit(missionId, "verdict.signed", { outcome, evidenceHash });
  return { verdict: outcome, signature, evidenceHash };
}
