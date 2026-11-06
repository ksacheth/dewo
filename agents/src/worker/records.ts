// An agent's private per-Mission notebook. Chain and Arkiv are the source of truth;
// this is a cache that says where the agent got to, written only after an action is
// confirmed. Both the Worker and the Requester use these stores.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type Stage =
  | "SKIPPED"
  | "BID_PLACED"
  | "WON"
  | "STAKED"
  | "EPISODE_RUNNING"
  | "SUBMITTED"
  | "LOST"
  | "GAVE_UP"
  | "DONE";

/** Stages the Worker still has to act on or watch. */
export const ACTIVE_STAGES: ReadonlySet<Stage> = new Set(["BID_PLACED", "WON", "STAKED", "EPISODE_RUNNING", "SUBMITTED"]);

/** Stages that occupy the rover: the Worker bids on nothing else meanwhile. */
export const BUSY_STAGES: ReadonlySet<Stage> = new Set(["WON", "STAKED", "EPISODE_RUNNING"]);

export interface MissionRecord {
  missionId: string;
  stage: Stage;
  price?: number;
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
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.tmp`;
    writeFileSync(temp, JSON.stringify(this.all(), null, 2));
    renameSync(temp, this.path);
  }
}
