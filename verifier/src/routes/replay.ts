import { canonicalJson } from "@dewo/agents/formats";
import { keccak256, toBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { verifyEpisode } from "../checks/index.js";
import { classifyTimeline } from "../deadlines.js";
import { PendingError } from "../errors.js";
import type { EpisodeSource, EventSink, SimPort, VerdictSink, ZeroGPort } from "../ports.js";
import { Outcome, outcomeName, signVerdict, type OUTCOME_NAMES } from "../sign.js";

export interface ReplayDeps {
  source: EpisodeSource; sim: SimPort; zeroG: ZeroGPort;
  verdicts: VerdictSink; events: EventSink;
  key: Hex; escrow: Address; now: () => number; // unix seconds
}
/** `verdict` is the Outcome's name ("Pass", "Fail", ...), as the Requester agent and the web UI expect. */
export interface ReplayResponse { verdict: (typeof OUTCOME_NAMES)[number]; signature: Hex; evidenceHash: Hex }

const NO_EPISODE: Hex = `0x${"00".repeat(32)}`;

/** Decide the Outcome (by deadlines or by Replay), sign the Verdict, record it on Arkiv, and return it. */
export async function handleReplay(deps: ReplayDeps, missionId: Hex): Promise<ReplayResponse> {
  const loaded = await deps.source.load(missionId);
  const byDeadline = classifyTimeline({ ...loaded.timeline, now: deps.now() });

  let outcome: Outcome;
  let evidenceHash: Hex;
  let metrics = { pathCost: 0, optimalPathCost: 0, collisions: 0 };
  const episodeLogRoot = loaded.episode?.episodeLogRoot ?? NO_EPISODE;

  if (byDeadline !== null) {
    outcome = byDeadline;
    evidenceHash = keccak256(toBytes(canonicalJson({ missionId, outcome })));
  } else if (loaded.episode) {
    const result = await verifyEpisode(deps, { mission: loaded.mission, ...loaded.episode });
    outcome = result.outcome;
    evidenceHash = result.evidenceHash;
    metrics = { pathCost: result.pathCost, optimalPathCost: result.optimalPathCost, collisions: result.collisions };
  } else {
    throw new PendingError(`mission ${missionId} is pending: no Verdict can be signed yet`);
  }

  const signature = await signVerdict(deps.key, deps.escrow, { missionId, outcome, evidenceHash });
  const { entityKey } = await deps.verdicts.writeVerdict({
    missionId, worker: loaded.worker, outcome, difficultyClass: loaded.mission.difficultyClass, ...metrics, signature, evidenceHash, episodeLogRoot,
  });
  await deps.events.emit(missionId, "verdict.signed", {
    verifier: privateKeyToAccount(deps.key).address, outcome: outcomeName(outcome), evidenceHash, arkivKey: entityKey,
  });
  return { verdict: outcomeName(outcome), signature, evidenceHash };
}
