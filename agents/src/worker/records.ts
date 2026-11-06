// An agent's private per-Mission notebook. Chain and Arkiv are the source of truth;
// this is a cache that says where the agent got to, written only after an action is
// confirmed. Both the Worker and the Requester use these stores.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { EpisodeLog } from "../formats";

export type Stage =
  | "SKIPPED"
  | "BID_PLACED"
  | "WON"
  | "STAKED"
  | "EPISODE_RUNNING"
  | "EPISODE_DONE"
  | "SUBMITTED"
  | "LOST"
  | "GAVE_UP"
  | "DONE";

/** Stages the Worker still has to act on or watch. */
export const ACTIVE_STAGES: ReadonlySet<Stage> = new Set(["BID_PLACED", "WON", "STAKED", "EPISODE_RUNNING", "EPISODE_DONE", "SUBMITTED"]);

/** Stages that occupy the rover: the Worker bids on nothing else meanwhile. */
export const BUSY_STAGES: ReadonlySet<Stage> = new Set(["WON", "STAKED", "EPISODE_RUNNING", "EPISODE_DONE"]);

/** A flown Episode kept until its submission is confirmed, so a failed upload or submit never costs the flight. */
export interface FinishedEpisode {
  decisions: EpisodeLog["decisions"];
  /** Absolute instant after which the Episode Submission is too late. */
  deadline: number;
}

export interface MissionRecord {
  missionId: string;
  stage: Stage;
  price?: number;
  /** Set from EPISODE_DONE until the submission lands. */
  episode?: FinishedEpisode;
  /** Why the record reached its stage, for SKIPPED, LOST and GAVE_UP. */
  note?: string;
}

/** Any per-Mission record; the Requester keeps its own kind in the same stores. */
export interface Keyed {
  missionId: string;
}

export interface RecordStore<T extends Keyed = MissionRecord> {
  all(): T[];
  get(missionId: string): T | undefined;
  put(record: T): void;
}

export class MemoryRecordStore<T extends Keyed = MissionRecord> implements RecordStore<T> {
  protected readonly records = new Map<string, T>();

  all(): T[] {
    return [...this.records.values()];
  }

  get(missionId: string): T | undefined {
    return this.records.get(missionId);
  }

  put(record: T): void {
    this.records.set(record.missionId, record);
  }
}

/** A JSON file, rewritten atomically (temp file + rename) on every change. */
export class FileRecordStore<T extends Keyed = MissionRecord> extends MemoryRecordStore<T> {
  constructor(private readonly path: string) {
    super();
    if (!existsSync(path)) return;
    const saved = JSON.parse(readFileSync(path, "utf8")) as T[];
    for (const record of saved) this.records.set(record.missionId, record);
  }

  override put(record: T): void {
    super.put(record);
    // Private: the Requester's records hold the secret Course Seed.
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temp = `${this.path}.tmp`;
    writeFileSync(temp, JSON.stringify(this.all(), null, 2), { mode: 0o600 });
    renameSync(temp, this.path);
  }
}
