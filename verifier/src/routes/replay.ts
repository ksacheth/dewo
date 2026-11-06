import type { EventData } from "@dewo/board";
import { canonicalJson } from "@dewo/agents/formats";
import { keccak256, toBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { verifyEpisode } from "../checks/index.js";
import { classifyTimeline } from "../deadlines.js";
import { PendingError } from "../errors.js";
import type { EpisodeSource, EventSink, SimPort, VerdictEntity, VerdictSink, ZeroGPort } from "../ports.js";
import { Outcome, outcomeName, signVerdict, type OUTCOME_NAMES } from "../sign.js";

export interface ReplayDeps {
  source: EpisodeSource; sim: SimPort; zeroG: ZeroGPort;
  verdicts: VerdictSink; events: EventSink;
  key: Hex; escrow: Address; now: () => number; // unix seconds
}
/**
 * The I6 wire format of a paid POST /replay (spec 5.2, R9). `verdict` is the Outcome's name ("Pass", "Fail", ...), as the Requester
 * agent parses it. The measured integers are 0 when no Replay ran (a No-show or an early Fail).
 */
export interface ReplayResponse {
  verdict: (typeof OUTCOME_NAMES)[number]; signature: Hex; evidenceHash: Hex;
  steps: number; collisions: number;
}
/** A signed Verdict that has not left this process yet: nothing is written to Arkiv or the event feed until `publishVerdict`. */
export interface DecidedVerdict { response: ReplayResponse; entity: VerdictEntity }

const NO_EPISODE: Hex = `0x${"00".repeat(32)}`;

/** A 40-Decision Replay announces about this many progress steps, however long the Episode is. */
export const MAX_PROGRESS_EVENTS = 10;

/** The progress feed is display only: a failed write is logged and never fails the Replay. */
async function announce<T extends "replay.started" | "replay.progress">(deps: ReplayDeps, missionId: Hex, type: T, data: EventData[T]): Promise<void> {
  try {
    await deps.events.emit(missionId, type, data);
  } catch (e) {
    console.error(`replay ${missionId}: ${type} not emitted: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Emits `replay.progress` every ceil(total / MAX_PROGRESS_EVENTS) Decisions and at the last one. */
function progressReporter(deps: ReplayDeps, missionId: Hex) {
  const verifier = privateKeyToAccount(deps.key).address;
  return async (step: number, total: number) => {
    const every = Math.ceil(total / MAX_PROGRESS_EVENTS);
    if (step % every === 0 || step === total) await announce(deps, missionId, "replay.progress", { verifier, step, total });
  };
}

/** Decide the Outcome (by deadlines or by Replay) and sign the Verdict, without publishing it anywhere. */
export async function decideVerdict(deps: ReplayDeps, missionId: Hex): Promise<DecidedVerdict> {
  const loaded = await deps.source.load(missionId);
  const byDeadline = classifyTimeline({ ...loaded.timeline, ...loaded.mission.deadlines, now: deps.now() });

  let outcome: Outcome;
  let evidenceHash: Hex;
  let metrics = { steps: 0, collisions: 0 };
  const episodeLogRoot = loaded.episode?.episodeLogRoot ?? NO_EPISODE;

  if (byDeadline !== null) {
    outcome = byDeadline;
    evidenceHash = keccak256(toBytes(canonicalJson({ missionId, outcome })));
  } else if (loaded.episode) {
    await announce(deps, missionId, "replay.started", { verifier: privateKeyToAccount(deps.key).address, decisions: loaded.episode.decisionCount });
    const result = await verifyEpisode({ ...deps, onDecisionChecked: progressReporter(deps, missionId) }, { mission: loaded.mission, ...loaded.episode });
    outcome = result.outcome;
    evidenceHash = result.evidenceHash;
    metrics = { steps: result.steps, collisions: result.collisions };
  } else {
    throw new PendingError(`mission ${missionId} is pending: no Verdict can be signed yet`);
  }

  const signature = await signVerdict(deps.key, deps.escrow, { missionId, outcome, evidenceHash });
  return {
    response: { verdict: outcomeName(outcome), signature, evidenceHash, ...metrics },
    entity: { missionId, worker: loaded.worker, outcome, difficultyClass: loaded.mission.difficultyClass, ...metrics, signature, evidenceHash, episodeLogRoot },
  };
}

/** Record a decided Verdict on Arkiv and announce it on the I8 feed. */
export async function publishVerdict(deps: ReplayDeps, decided: DecidedVerdict): Promise<void> {
  const { entity } = decided;
  const { entityKey } = await deps.verdicts.writeVerdict(entity);
  await deps.events.emit(entity.missionId, "verdict.signed", {
    verifier: privateKeyToAccount(deps.key).address, outcome: outcomeName(entity.outcome), evidenceHash: entity.evidenceHash, arkivKey: entityKey,
  });
}

/** Decide, sign and publish in one go (no payment step in between). */
export async function handleReplay(deps: ReplayDeps, missionId: Hex): Promise<ReplayResponse> {
  const decided = await decideVerdict(deps, missionId);
  await publishVerdict(deps, decided);
  return decided.response;
}
