// I8 event feed types and name rules.
// Mirrors EventData in @dewo/board's events.ts (M3 owns it) exactly, all 11 types. Import it from
// there once M4 can depend on @dewo/board; until then a drift here is only caught by review, so
// keep it in step. M4 emits 9 of them; bids.revealed and verdict.signed are emitted by the
// Verifiers (M5, process name verifier-<n>) and are mirrored here only so the type is complete.
// Amounts are strings of USDC base units.

type Addr = string;

export interface EventData {
  "mission.posted": { difficultyClass: string; maxBounty: string; riskWeight: number; biddingClosesAt: number; arkivKey: string };
  "bid.sealed": { worker: Addr; workerName: string; policyHash: string; arkivKey: string };
  /** Emitted by the Verifiers (M5), not by M4. */
  "bids.revealed": { bids: { worker: Addr; workerName: string; price: string; R: number; score: number }[]; winner: Addr };
  "award.signed": { worker: Addr; price: string; stake: string; verifier: Addr };
  "stake.deposited": { worker: Addr; stake: string };
  "seed.released": { worker: Addr; arkivKey: string };
  /** frame is a path relative to the runs/ folder, served by the web as /runs/<frame>. */
  "decision.made": { step: number; frame: string; chatID: string; action: string };
  "episode.submitted": { episodeLogRoot: string; policyRoot: string; decisionCount: number };
  "replay.paid": { verifier: Addr; status: 402 | "paid"; amount: string };
  /** Emitted by the Verifiers (M5), not by M4. */
  "verdict.signed": { verifier: Addr; outcome: string; evidenceHash: string; arkivKey: string };
  settled: { outcome: string; workerPayout: string; requesterPayout: string };
}

export type EventType = keyof EventData;

const MISSION_ID = /^0x[0-9a-fA-F]{64}$/;
const PROCESS = /^[a-z0-9-]+$/;

export function assertMissionId(missionId: string): void {
  if (!MISSION_ID.test(missionId)) throw new Error(`invalid missionId: ${missionId}`);
}

export function assertProcessName(name: string): void {
  if (!PROCESS.test(name)) throw new Error(`invalid process name: ${name}`);
}

export const REQUESTER_PROCESS = "requester";

/** One event file per process: "worker-<policy name lowercased, anything outside [a-z0-9-] as ->". */
export function workerProcess(policyName: string): string {
  return `worker-${policyName.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
}
